const mongoose = require("mongoose");

const scanSchema = new mongoose.Schema({
    date:{
        type:Date,
        required:true,
        default:Date.now,
    },
    foodItems:[{
        name:String,
        confidence:Number,
        nutrients:{
            calories:Number,
            fats:Number,
            carbohydrates:Number,
            protiens:Number,
            vitamins:[String],
            minerals:[String]
        }
    }]
})

module.exports = mongoose.model("Scan",scanSchema);