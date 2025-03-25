const User = require('../models/User');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const speakeasy = require('speakeasy');
const { generateOTP } = require('../utils/otpUtils');

// Configure email transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.EMAIL_USERNAME, 
    pass: process.env.EMAIL_PASSWORD,
  }
});

// Register
exports.register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Validate email domain
    if (!email.endsWith('@iitk.ac.in')) {
      return res.status(400).json({ message: 'Only IITK email domains (@iitk.ac.in) are allowed' });
    }

    // Check if user already exists
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Generate OTP for email verification
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // OTP valid for 10 minutes

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user with unverified status
    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      emailVerificationOTP: otp,
      emailVerificationOTPExpiry: otpExpiry,
      emailVerified: false,
    });

    // Send verification OTP to email
    await sendVerificationEmail(email, otp);

    res.status(201).json({ 
      message: 'Registration initiated. Please verify your email address with the OTP sent to your email.',
      userId: user._id 
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Verify Email with OTP
exports.verifyEmail = async (req, res) => {
  try {
    const { userId, otp } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if OTP is valid and not expired
    if (user.emailVerificationOTP !== otp || new Date() > user.emailVerificationOTPExpiry) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    // Mark email as verified
    user.emailVerified = true;
    user.emailVerificationOTP = undefined;
    user.emailVerificationOTPExpiry = undefined;
    await user.save();

    res.status(200).json({ message: 'Email verified successfully' });
  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Login
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Validate email domain
    if (!email.endsWith('@iitk.ac.in')) {
      return res.status(400).json({ message: 'Only IITK email domains (@iitk.ac.in) are allowed' });
    }

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Check if email is verified
    if (!user.emailVerified) {
      // Generate new OTP if needed
      const otp = generateOTP();
      const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
      
      user.emailVerificationOTP = otp;
      user.emailVerificationOTPExpiry = otpExpiry;
      await user.save();
      
      // Send new verification OTP
      await sendVerificationEmail(email, otp);
      
      return res.status(401).json({ 
        message: 'Email not verified. A new verification OTP has been sent to your email.',
        userId: user._id 
      });
    }

    // Validate password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Check if 2FA is enabled
    if (user.twoFactorEnabled) {
      // Generate and send OTP for 2FA
      const twoFactorOTP = generateOTP();
      const twoFactorOTPExpiry = new Date(Date.now() + 10 * 60 * 1000);
      
      user.twoFactorOTP = twoFactorOTP;
      user.twoFactorOTPExpiry = twoFactorOTPExpiry;
      await user.save();
      
      // Send 2FA OTP to email
      await send2FAOTP(email, twoFactorOTP);
      
      return res.status(200).json({
        message: '2FA verification required',
        requires2FA: true,
        userId: user._id
      });
    }

    // Create and send token
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: '1d',
    });

    res.status(200).json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Verify 2FA OTP
exports.verify2FA = async (req, res) => {
  try {
    const { userId, otp } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if OTP is valid and not expired
    if (user.twoFactorOTP !== otp || new Date() > user.twoFactorOTPExpiry) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    // Clear 2FA OTP
    user.twoFactorOTP = undefined;
    user.twoFactorOTPExpiry = undefined;
    await user.save();

    // Create and send token
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: '1d',
    });

    res.status(200).json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    console.error('2FA verification error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Setup 2FA with authenticator app
exports.setup2FAAuthenticator = async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Generate a secret key for the authenticator app
    const secret = speakeasy.generateSecret({
      length: 20,
      name: `IITK_Blog:${user.email}`
    });
    
    user.twoFactorSecret = secret.base32;
    user.twoFactorEnabled = false; // Not enabled until verified
    await user.save();

    res.status(200).json({
      message: 'Authentication app setup initiated',
      secret: secret.base32,
      otpauth_url: secret.otpauth_url
    });
  } catch (error) {
    console.error('2FA setup error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Verify and enable 2FA with authenticator app
exports.verify2FAAuthenticator = async (req, res) => {
  try {
    const userId = req.user.id;
    const { token } = req.body;

    const user = await User.findById(userId);
    if (!user || !user.twoFactorSecret) {
      return res.status(404).json({ message: 'User not found or 2FA not initialized' });
    }

    // Verify the token against the stored secret using speakeasy
    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: token,
      window: 1
    });

    if (!verified) {
      return res.status(400).json({ message: 'Invalid authentication code' });
    }

    // Enable 2FA
    user.twoFactorEnabled = true;
    await user.save();

    res.status(200).json({ message: '2FA enabled successfully' });
  } catch (error) {
    console.error('2FA verification error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Helper functions
async function sendVerificationEmail(email, otp) {
  const mailOptions = {
    from: process.env.EMAIL_USERNAME,
    to: email,
    subject: 'IITK Blog - Email Verification',
    html: `
      <h1>Email Verification</h1>
      <p>Your verification OTP is: <strong>${otp}</strong></p>
      <p>This OTP will expire in 10 minutes.</p>
    `,
  };

  await transporter.sendMail(mailOptions);
}

async function send2FAOTP(email, otp) {
  const mailOptions = {
    from: process.env.EMAIL_USERNAME,
    to: email,
    subject: 'IITK Blog - 2FA Verification',
    html: `
      <h1>Two-Factor Authentication</h1>
      <p>Your 2FA verification code is: <strong>${otp}</strong></p>
      <p>This code will expire in 10 minutes.</p>
    `,
  };

  await transporter.sendMail(mailOptions);
}
