const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// MongoDB Schemas (inline để tránh lỗi thư mục)
const messageSchema = new mongoose.Schema({
    room: {
        type: String,
        required: true,
        default: 'general'
    },
    username: {
        type: String,
        required: true,
        trim: true,
        maxlength: 50
    },
    message: {
        type: String,
        required: true,
        trim: true,
        maxlength: 1000
    },
    timestamp: {
        type: Date,
        default: Date.now
    },
    socketId: {
        type: String,
        required: true
    }
}, {
    timestamps: true
});

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        trim: true,
        minlength: 2,
        maxlength: 50
    },
    socketId: {
        type: String,
        required: true,
        unique: true
    },
    room: {
        type: String,
        default: 'general'
    },
    joinedAt: {
        type: Date,
        default: Date.now
    },
    lastActive: {
        type: Date,
        default: Date.now
    },
    isOnline: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// Create models
const Message = mongoose.model('Message', messageSchema);
const User = mongoose.model('User', userSchema);

// Kết nối MongoDB với retry logic
async function connectMongoDB() {
    try {
        // Sử dụng DB_URI hoặc MONGODB_URI, thêm database name
        let mongoUri = process.env.DB_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/chatapp';
        
        // Thêm database name nếu chưa có
        if (mongoUri.includes('mongodb+srv://') && !mongoUri.includes('/chatapp')) {
            // Thay thế /?retryWrites bằng /chatapp?retryWrites
            mongoUri = mongoUri.replace('/?', '/chatapp?');
        }
        
        console.log('[DATABASE] Đang kết nối tới MongoDB...');
        console.log('[DATABASE] URI:', mongoUri.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@')); // Hide credentials
        
        await mongoose.connect(mongoUri, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 15000, // 15 seconds
            socketTimeoutMS: 45000, // 45 seconds
            maxPoolSize: 10, // Maintain up to 10 socket connections
            // Removed deprecated options
            // bufferCommands: false, // Removed - deprecated
            // bufferMaxEntries: 0, // Removed - deprecated and causing error
        });
        
        console.log('[DATABASE] Đã kết nối thành công tới MongoDB!');
        console.log('[DATABASE] Database name:', mongoose.connection.db.databaseName);
        return true;
    } catch (error) {
        console.error('[DATABASE] Lỗi kết nối MongoDB:', error.message);
        console.log('[DATABASE] Chuyển sang sử dụng Memory Storage...');
        return false;