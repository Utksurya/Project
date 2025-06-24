const express = require("express");
const router = express.Router();
const wrapAsync = require("../utils/wrapAsync.js");
const Listing = require("../models/listing.js");
const Booking = require("../models/booking.js");
const {isLoggedIn} = require("../middleware.js");
const multer = require("multer");
const {storage} = require("../cloudConfig.js");
const upload = multer({storage});
const nodemailer = require("nodemailer");


  
router.get("/", wrapAsync(async (req, res) => {
    const { location, category } = req.query;

    const filter = {};
    if (location) {
        filter.location = { $regex: location, $options: "i" };
    }
   if (category && category.toLowerCase() !== "trending") {
        filter.category = { $regex: new RegExp(category, "i") };
    }

    const allListings = await Listing.find(filter).sort({ createdAt: -1 });

    res.render("listings/index.ejs", {
        allListings,
        searchQuery: location || "",
        selectedCategory: category || ""
    });
}));




//New Route
router.get("/new",isLoggedIn, (req, res) => {
    res.render("listings/new.ejs");
});
router.get("/dashboard", isLoggedIn, async (req, res) => {
  const listings = await Listing.find({ owner: req.user._id })
    .populate({
      path: "bookings",
      populate: { path: "user", select: "username" },
      options: { sort: { startDate: -1 } }
    });

  const now = new Date();

  listings.forEach(listing => {
    listing.activeBookings = [];
    listing.expiredBookings = [];
    listing.pendingBookings = [];

    for (let booking of listing.bookings) {
      if (booking.status === "pending" && new Date(booking.endDate) >= now) {
        listing.pendingBookings.push(booking);
      } else if (booking.status === "confirmed" && new Date(booking.endDate) >= now) {
        listing.activeBookings.push(booking);
      } else {
        listing.expiredBookings.push(booking);
      }
    }
  });

  res.render("dashboard", { listings });
});



//Show Route

router.get("/:id", async (req, res) => {
  const { id } = req.params;

  const listing = await Listing.findById(id)
    .populate({
      path: "reviews",
      populate: {
        path: "author",
      },
    })
    .populate("owner");

  let booking = null;
  let bookingMadeByCurrentUser = false;

  if (req.user) {
   
    booking = await Booking.findOne({
      listing: listing._id,
      user: req.user._id,
    })
      .sort({ createdAt: -1 })
      .exec(); 

    if (booking) {
      bookingMadeByCurrentUser = true;
    }
  }

  res.render("listings/show.ejs", {
    listing,
    booking,
    bookingMadeByCurrentUser,
  });
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
    listing.bookings.push(booking._id);
    await listing.save();

    req.flash("success", "Property booked successfully!");
    res.redirect(`/listings/${id}`);
});

router.post("/:id/bookings", isLoggedIn, wrapAsync(async (req, res) => {
  const { id } = req.params;
  const { startDate, endDate } = req.body;

  if (new Date(startDate) >= new Date(endDate)) {
    req.flash("error", "End date must be after start date");
    return res.redirect(`/listings/${id}`);
  }

  const listing = await Listing.findById(id).populate("bookings");

  // Check for date overlap for current user
  const userBookings = await Booking.find({
    listing: id,
    user: req.user._id,
    status: { $in: ["confirmed", "pending"] }, // Ignore rejected
  });

  const newStart = new Date(startDate);
  const newEnd = new Date(endDate);

  const isOverlapping = userBookings.some(b => {
    const existingStart = new Date(b.startDate);
    const existingEnd = new Date(b.endDate);
    return (newStart < existingEnd && newEnd > existingStart);
  });

  if (isOverlapping) {
    req.flash("error", "You already have a booking that overlaps with these dates.");
    return res.redirect(`/listings/${id}`);
  }

  // Save booking
  const booking = new Booking({
    listing: id,
    user: req.user._id,
    startDate,
    endDate,
  });

  await booking.save();
  listing.bookings.push(booking._id);
  await listing.save();

  // req.flash("success", "Booking successful!");
  res.redirect(`/listings/${id}`);
}));

router.post("/bookings/:id/confirm", isLoggedIn, async (req, res) => {
  const booking = await Booking.findById(req.params.id)
    .populate("listing")
    .populate("user"); // populate user to get email

  if (!booking) return res.redirect("/listings/dashboard");

  // Ownership check
  if (!booking.listing.owner.equals(req.user._id)) {
    req.flash("error", "You are not authorized to confirm this booking.");
    return res.redirect("/listings/dashboard");
  }

  // Check for overlapping confirmed bookings
  const existingConfirmed = await Booking.find({
    listing: booking.listing._id,
    status: "confirmed",
    _id: { $ne: booking._id }
  });

  const newStart = new Date(booking.startDate);
  const newEnd = new Date(booking.endDate);

  const isOverlapping = existingConfirmed.some(b => {
    const existingStart = new Date(b.startDate);
    const existingEnd = new Date(b.endDate);
    return newStart < existingEnd && newEnd > existingStart;
  });

  if (isOverlapping) {
    req.flash("error", "Another booking is already confirmed for these dates.");
    return res.redirect("/listings/dashboard");
  }

  //Confirm booking
  booking.status = "confirmed";
  await booking.save();

  // Send email to user
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: booking.user.email,
    subject: "Your Stayit Booking is Confirmed!",
    html: `
      <p>Hello ${booking.user.username},</p>
      <p>Your booking for <strong>${booking.listing.title}</strong> has been confirmed by the property owner.</p>
      <p>Booking dates: <strong>${booking.startDate.toDateString()}</strong> to <strong>${booking.endDate.toDateString()}</strong></p>
      <p>Thank you for choosing Stayit!</p>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    req.flash("success", "Booking confirmed and user notified via email.");
  } catch (err) {
    console.error("Email error:", err);
    req.flash("error", "Booking confirmed but failed to send confirmation email.");
  }

  res.redirect("/listings/dashboard");
});


router.post("/bookings/:id/reject", isLoggedIn, async (req, res) => {
  const booking = await Booking.findById(req.params.id).populate("listing");
  if (!booking) return res.redirect("/listings/dashboard");


  if (!booking.listing.owner.equals(req.user._id)) {
    req.flash("error", "You are not authorized to reject this booking.");
    return res.redirect("/listings/dashboard");

  }

  booking.status = "rejected";
  await booking.save();
  req.flash("info", "Booking rejected.");
  res.redirect("/listings/dashboard");

});
module.exports = router;