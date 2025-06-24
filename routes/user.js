const express = require("express");
const router = express.Router();
const User = require("../models/user.js");
const wrapAsync = require("../utils/wrapAsync");
const passport = require("passport");
const { saveRedirectUrl } = require("../middleware.js");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

// GET: Signup form
router.get("/signup", (req, res) => {
    res.render("users/signup.ejs");
});

// POST: Signup and send verification email
router.post("/signup", wrapAsync(async (req, res) => {
    try {
        const { username, email, password } = req.body;

        const newUser = new User({ username, email });
        const registeredUser = await User.register(newUser, password);

        // JUGAAD: Mark as verified
        registeredUser.isVerified = true;

        // Optionally still generate a token
        const token = crypto.randomBytes(32).toString("hex");
        registeredUser.verificationToken = token;
        registeredUser.verificationTokenExpires = Date.now() + 1000 * 60 * 60 * 24;

        await registeredUser.save();

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });

        const verificationLink = `${process.env.BASE_URL}/verify/${token}`;

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Verify your Stayit account',
            html: `<p>Hello ${username},</p>
                   <p>Please verify your email by clicking the link below:</p>
                   <a href="${verificationLink}">Verify Email</a>`
        };

        await transporter.sendMail(mailOptions);

        req.flash("success", "Verification mail sent. Account already verified.");
        res.redirect("/login");

    } catch (e) {
        req.flash("error", e.message);
        res.redirect("/signup");
    }
}));



// GET: Verify Email Token
router.get("/verify/:token", wrapAsync(async (req, res) => {
    const { token } = req.params;

    const user = await User.findOne({
        verificationToken: token,
        verificationTokenExpires: { $gt: Date.now() }
    });

    if (!user) {
        req.flash("error", "Invalid or expired verification link.");
        return res.redirect("/signup");
    }

    user.isVerified = true;
    user.verificationToken = undefined;
    user.verificationTokenExpires = undefined;
    await user.save();

    req.login(user, (err) => {
        if (err) {
            req.flash("success", "Email verified. Please login.");
            return res.redirect("/login");
        }
        req.flash("success", "Your email has been successfully verified!");
        res.redirect("/listings");
    });
}));

// GET: Login form
router.get("/login", (req, res) => {
    res.render("users/login.ejs");
});

// POST: Login with email verification check
router.post("/login",
    saveRedirectUrl,
    passport.authenticate("local", {
        failureRedirect: "/login",
        failureFlash: true
    }),
    async (req, res, next) => {
        if (!req.user.isVerified) {
            req.logout((err) => {
                if (err) return next(err);
                req.flash("error", "Please verify your email before logging in.");
                res.redirect("/login");
            });
        } else {
            req.flash("success", "Welcome to Stayit");
            const redirectUrl = res.locals.redirectUrl || "/listings";
            res.redirect(redirectUrl);
        }
    }
);

// GET: Logout
router.get("/logout", (req, res, next) => {
    req.logout((err) => {
        if (err) return next(err);
        req.flash("success", "You are logged out");
        res.redirect("/listings");
    });
});



module.exports = router;
