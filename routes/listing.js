const express = require("express");
const router = express.Router();
const wrapAsync = require("../utils/wrapAsync.js");
const Listing = require("../models/listing.js");
const Booking = require("../models/booking.js");
const {isLoggedIn} = require("../middleware.js");
const multer = require("multer");
const {storage} = require("../cloudConfig.js");
const upload = multer({storage});


//Index Route
// router.get("/", wrapAsync (async (req, res) => {
//     const allListings = await Listing.find({});
//     res.render("listings/index.ejs", { allListings });
//   }));
  
router.get("/", wrapAsync (async (req, res) => {
    const { location } = req.query;

    let allListings;
    if (location) {
        allListings = await Listing.find({
            location: { $regex: location, $options: "i" } // partial, case-insensitive match
        });
    } else {
        allListings = await Listing.find({});
    }

    res.render("listings/index.ejs", { allListings, searchQuery: location || "" });
}));




//New Route
router.get("/new",isLoggedIn, (req, res) => {
    res.render("listings/new.ejs");
});

//Show Route
router.get("/:id", async (req, res) => {
    let { id } = req.params;
    const listing = await Listing.findById(id)
    .populate({
      path: "reviews", 
      populate: {
        path: "author",
      },
    })
    .populate("owner");
    res.render("listings/show.ejs", { listing });
});
  
//Create Route
router.post("/", isLoggedIn,upload.single('listing[image]'), async (req, res) => {
    let url = req.file.path;
    let filename = req.file.filename;

    const newListing = new Listing(req.body.listing);
    newListing.owner = req.user._id;
    newListing.image = {url, filename};
    await newListing.save();
    req.flash("success","New listing created!");
    res.redirect("/listings");
  });
  
//Edit Route
router.get("/:id/edit", isLoggedIn, async (req, res) => {
    let { id } = req.params;
    const listing = await Listing.findById(id);
    res.render("listings/edit.ejs", { listing });
});
  
//Update Route
router.put("/:id", isLoggedIn,upload.single('listing[image]'), async (req, res) => {
    let { id } = req.params;
    let listing = await Listing.findById(id);
    if(!listing.owner.equals(res.locals.currUser._id)) {
      req.flash("error","You cannot edit");
      return res.redirect(`/listings/${id}`);
    }
    let listings = await Listing.findByIdAndUpdate(id, { ...req.body.listing });

    if(typeof req.file !== "undefined"){
        let url = req.file.path;
        let filename = req.file.filename;
        listings.image = {url,filename};
        await listings.save();
    }

    req.flash("success","Listing updated");
    res.redirect(`/listings/${id}`);
});

//Delete Route
router.delete("/:id", isLoggedIn, async (req, res) => {
    let { id } = req.params;
    let deletedListing = await Listing.findByIdAndDelete(id);
    console.log(deletedListing);
    req.flash("success", "Listing Deleted");
    res.redirect("/listings");
});

// POST: Handle booking
router.post("/:id/book", isLoggedIn, async (req, res) => {
    const { id } = req.params;
    const { startDate, endDate } = req.body;

    const listing = await Listing.findById(id);
    if (!listing) {
        req.flash("error", "Listing not found!");
        return res.redirect("/listings");
    }

    const booking = new Booking({
        user: req.user._id,
        listing: id,
        startDate,
        endDate,
    });

    await booking.save();
    req.flash("success", "Property booked successfully!");
    res.redirect(`/listings/${id}`);
});

// Booking route to create a new booking for a listing
router.post("/:id/bookings", isLoggedIn, wrapAsync(async (req, res) => {
  const { id } = req.params; // listing id
  const { startDate, endDate } = req.body;

  // Validate dates: startDate must be before endDate
  if (new Date(startDate) >= new Date(endDate)) {
    req.flash("error", "End date must be after start date");
    return res.redirect(`/listings/${id}`);
  }

  // Create booking
  const booking = new Booking({
    listing: id,
    user: req.user._id,
    startDate,
    endDate,
  });

  await booking.save();

  req.flash("success", "Booking successful!");
  res.redirect(`/listings/${id}`);
}));


module.exports = router;