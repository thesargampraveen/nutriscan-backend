const express = require('express');
const multer = require('multer');
const axios = require('axios');
const mongoose = require('mongoose');
const app = express();
const upload = multer({dest: 'uploads/'});

const cors = require('cors');

app.use(cors());
app.use(express.json());
const moment = require('moment');
const Scan = require('./models/scan');

mongoose
  .connect('mongodb+srv://admin:admin@cluster0.nupict5.mongodb.net/')
  .then(() => {
    console.log('MongoDB Connected');
  })
  .catch(err => {
    console.log('Error Connecting to MongoDB', err);
  });

app.listen(3000, () => console.log('Server running on port 3000'));

const CLARIFAI_PAT = '42d9d3f85d584f3aad559fca6cbe04b8';

// USDA API credentials
const USDA_API_KEY = 'efIZhWcrJbcroYM7yMtTsjIctEyUPxs3DLGb4cqo';

const foodKeywords = [
  'pizza',
  'burger',
  'sandwich',
  'salad',
  'pasta',
  'sushi',
  'cake',
  'cookie',
  'bread',
  'fruit',
  'vegetable',
  'meat',
  'chicken',
  'fish',
  'rice',
  'soup',
  'noodles',
  'ice cream',
  'chocolate',
  'cheese',
  'egg',
  'fries',
  'taco',
  'burrito',
  'steak',
  'pancake',
  'waffle',
  'smoothie',
  'juice',
  'coffee',
  'tea',
  'drink',
  'apple',
  'banana',
  'orange',
  'grape',
  'strawberry',
  'blueberry',
  'mango',
  'potato',
  'tomato',
  'carrot',
  'broccoli',
  'spinach',
  'lettuce',
  'onion',
  'jeera rice',
  'fried rice',
  'chicken fried rice',
  'tandoori chicken',
  'mexican chicken',
  'omelette',
  'milkshake',
  'dal',
  'curry',
  'biryani',
  'naan',
  'roti',
  'paneer',
  'samosa',
  'dosa',
  'idli',
  'vada',
  'chutney',
  'gravy',
  'stew',
  'kebab',
  'shawarma',
  'falafel',
  'hummus',
  'pulao',
  'khichdi',
  'paratha',
];

app.post('/analyze-food', upload.single('image'), async (req, res) => {
  try {
    const imagePath = req.file.path;
    const imageBase64 = require('fs').readFileSync(imagePath, {
      encoding: 'base64',
    });

    console.log('imagePath', imagePath);
    console.log('image base 64', imageBase64.length);

    const clarifaiResponse = await axios.post(
      'https://api.clarifai.com/v2/models/food-item-recognition/outputs',
      {
        user_app_id: {
          user_id: 'clarifai',
          app_id: 'main',
        },
        inputs: [
          {
            data: {
              image: {base64: imageBase64},
            },
          },
        ],
      },
      {
        headers: {
          Authorization: `Key ${CLARIFAI_PAT}`,
          'Content-Type': 'application/json',
        },
      },
    );

    console.log(
      'Clarifai response: ',
      JSON.stringify(clarifaiResponse.data, null, 2),
    );

    const concepts = clarifaiResponse.data.outputs[0].data.concepts;
    const isFood = concepts.some(concept => {
      const conceptName = concept.name.toLowerCase();
      return (
        foodKeywords.some(keyword => conceptName.includes(keyword)) ||
        concept.value > 0.3
      );
    });

    if (!isFood) {
      console.log('Image is not a food item');
      return res.json({isFood: false});
    }

    const foodItems = concepts
      .filter(concept => {
        const conceptName = concept.name.toLowerCase();
        return (
          foodKeywords.some(keyword => conceptName.includes(keyword)) &&
          concept.value > 0.3
        );
      })
      .map(concept => ({
        name: concept.name,
        confidence: concept.value,
      }));

    if (foodItems.length === 0) {
      return res.json({isFood: false});
    }

    const foodDetails = await Promise.all(
      foodItems.map(async foodItem => {
        try {
          const usdaResponse = await axios.get(
            `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${USDA_API_KEY}&query=${foodItem.name}&pageSize=1`,
          );

          const foodData = usdaResponse.data.foods[0];
          if (!foodData) {
            return {
              name: foodItem?.name,
              confidence: foodItem.confidence,
              nutrients: null,
            };
          }

          const nutrients = {
            calories:
              foodData.foodNutrients.find(n => n.nutrientName === 'Energy')
                ?.value || 0,
            fats:
              foodData.foodNutrients.find(
                n => n.nutrientName === 'Total lipid (fat)',
              )?.value || 0,
            carbohydrates:
              foodData.foodNutrients.find(
                n => n.nutrientName === 'Carbohydrate, by difference',
              )?.value || 0,
            proteins:
              foodData.foodNutrients.find(n => n.nutrientName === 'Protein')
                ?.value || 0,
            vitamins: foodData.foodNutrients
              .filter(n => n.nutrientName.includes('Vitamin'))
              .map(v => v.nutrientName),
            minerals: foodData.foodNutrients
              .filter(
                n =>
                  n.nutrientName.includes('Calcium') ||
                  n.nutrientName.includes('Iron'),
              )
              .map(m => m.nutrientName),
          };

          return {
            name: foodItem.name,
            confidence: foodItem.confidence,
            nutrients,
          };
        } catch (error) {
          console.log(
            `ERROR fetching USDA DATA for ${foodItem.name}`,
            error.message,
          );
          return {
            name: foodItem?.name,
            confidence: foodItem.confidence,
            nutrients: null,
          };
        }
      }),
    );

    const scan = new Scan({
      date: new Date(),
      foodItems: foodDetails,
    });

    await scan.save();

    console.log('food details', foodDetails);
    res.json({isFood: true, foodItems: foodDetails});
  } catch (error) {
    console.log('Error analyzing image', error);
    if (error.response) {
      console.error('Error response data', error.response.data);
      console.error('Error response status', error.response.status);
      console.error('Error response headers', error.response.headers);
    }
    res.status(500).json({message: 'Failed to analyze image'});
  }
});

app.get('/scans/month/:year/:month', async (req, res) => {
  const {year, month} = req.params;
  const startDate = moment(`${year}-${month}-01`, 'YYYY-MM-DD')
    .startOf('month')
    .toDate();
  const endDate = moment(startDate).endOf('month').toDate();

  const scans = await Scan.find({
    date: {$gte: startDate, $lte: endDate},
  });
  res.json({totalScans: scans.length, scans});
});

app.get('/scans/week', async (req, res) => {
  const startOfWeek = moment().startOf('week').toDate();
  const endOfWeek = moment().endOf('week').toDate();

  const scans = await Scan.find({
    date: { $gte: startOfWeek, $lte: endOfWeek },
  });
  res.json({ totalScans: scans.length, scans });
});

app.get('/scans/today', async (req, res) => {
  const startOfDay = moment().startOf('day').toDate();
  const endOfDay = moment().endOf('day').toDate();

  const scans = await Scan.find({
    date: {$gte: startOfDay, $lte: endOfDay},
  });
  res.json({totalScans: scans.length, scans});
});

app.get('/scans/date/:date', async (req, res) => {
  const {date} = req.params;
  const scanDate = moment(date, 'YYYY-MM-DD').toDate();
  const scans = await Scan.find({
    date: {
      $gte: moment(scanDate).startOf('day').toDate(),
      $lte: moment(scanDate).endOf('day').toDate(),
    },
  });

  res.json({scans});
});

app.get('/scans/last-three-days', async (req, res) => {
  try {
    const dates = [];
    for (let i = 2; i >= 0; i--) {
      const date = moment().subtract(i, 'days').startOf('day').toDate();
      const scans = await Scan.find({
        date: {$gte: date, $lte: moment(date).endOf('day').toDate()},
      });
      dates.push({date: moment(date).format('YYYY-MM-DD'), scans});
    }
    res.json({data: dates});
  } catch (error) {
    console.log('Error', error);
  }
});
