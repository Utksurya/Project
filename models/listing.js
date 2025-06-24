const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const Review = require("./review.js");

const listingSchema = new Schema({
  title: {
    type: String,
    required: true,
  },
  description: String,
  image: {
    url: String,
    filename: String,
  },
  price: Number,
  location: String,
  country: String,
  category: {
  type: String,
  enum: ['trending', 'room', 'pool', 'villa', 'apartment','pg'],
  required: true
},
  reviews: [{
    type: Schema.Types.ObjectId,
    ref: "Review",
  }],
  bookings: [{
    type: Schema.Types.ObjectId,
    ref: "Booking", 
  }],
  owner: {
    type: Schema.Types.ObjectId,
    ref: "User",
  },
}, { timestamps: true });

listingSchema.post("findOneAndDelete", async(listing) => {
  if(listing){
    await Review.deleteMany({ _id: { $in: listing.reviews } });
  }
});

const Listing = mongoose.model("Listing", listingSchema);
module.exports = Listing;
