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
            bufferCommands: false, // Disable mongoose buffering
            bufferMaxEntries: 0, // Disable mongoose buffering
        });
        
        console.log('[DATABASE] Đã kết nối thành công tới MongoDB!');
        console.log('[DATABASE] Database name:', mongoose.connection.db.databaseName);
        return true;
    } catch (error) {
        console.error('[DATABASE] Lỗi kết nối MongoDB:', error.message);
        console.log('[DATABASE] Chuyển sang sử dụng Memory Storage...');
        return false;
    }
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Cấu hình Content Security Policy
app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', 
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://translate.google.com https://translate.googleapis.com; " +
        "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://fonts.googleapis.com https://www.gstatic.com https://translate.googleapis.com; " +
        "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com; " +
        "img-src 'self' data: https: http:; " +
        "connect-src 'self' ws: wss: https://translate.googleapis.com; " +
        "frame-src 'self' https://translate.google.com;"
    );
    next();
});

// Phục vụ file static
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    });
});

// API Routes với error handling
app.get('/api/messages/:room', async (req, res) => {
    try {
        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({
                success: false,
                error: 'Database không có sẵn'
            });
        }

        const { room } = req.params;
        const limit = parseInt(req.query.limit) || 50;
        
        const messages = await Message.find({ room })
            .sort({ timestamp: -1 })
            .limit(limit)
            .lean();
            
        res.json({
            success: true,
            messages: messages.reverse()
        });
    } catch (error) {
        console.error('[API] Lỗi lấy tin nhắn:', error);
        res.status(500).json({
            success: false,
            error: 'Không thể lấy tin nhắn'
        });
    }
});

app.get('/api/users/:room', async (req, res) => {
    try {
        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({
                success: false,
                error: 'Database không có sẵn'
            });
        }

        const { room } = req.params;
        
        const users = await User.find({ room, isOnline: true })
            .select('username joinedAt')
            .sort({ joinedAt: -1 })
            .lean();
            
        res.json({
            success: true,
            users,
            count: users.length
        });
    } catch (error) {
        console.error('[API] Lỗi lấy danh sách user:', error);
        res.status(500).json({
            success: false,
            error: 'Không thể lấy danh sách người dùng'
        });
    }
});

// 404 handler
app.use((req, res) => {
    console.log(`[404] Không tìm thấy: ${req.url}`);
    res.status(404).json({ error: 'Trang không tồn tại' });
});

// In-memory storage cho trường hợp MongoDB không khả dụng
const memoryStorage = {
    users: new Map(),
    messages: []
};

// Socket.IO Logic
io.on('connection', (socket) => {
    console.log('[SOCKET] Người dùng đã kết nối:', socket.id);
    
    // Xử lý đăng ký username
    socket.on('register-user', async (data) => {
        try {
            const { username, room = 'general' } = data;
            
            if (!username || username.trim().length < 2) {
                socket.emit('registration-error', 'Tên người dùng phải có ít nhất 2 ký tự');
                return;
            }
            
            const trimmedUsername = username.trim();
            
            // Kiểm tra MongoDB connection
            if (mongoose.connection.readyState === 1) {
                // Sử dụng MongoDB
                const existingUser = await User.findOne({ 
                    username: trimmedUsername, 
                    room, 
                    isOnline: true 
                });
                
                if (existingUser) {
                    socket.emit('registration-error', 'Tên người dùng đã được sử dụng trong phòng này');
                    return;
                }
                
                const user = new User({
                    username: trimmedUsername,
                    socketId: socket.id,
                    room
                });
                
                await user.save();
                console.log('[USER] Đã lưu user vào MongoDB:', trimmedUsername);
            } else {
                // Sử dụng memory storage
                const existingUser = Array.from(memoryStorage.users.values())
                    .find(u => u.username === trimmedUsername && u.room === room && u.isOnline);
                
                if (existingUser) {
                    socket.emit('registration-error', 'Tên người dùng đã được sử dụng trong phòng này');
                    return;
                }
                
                memoryStorage.users.set(socket.id, {
                    username: trimmedUsername,
                    socketId: socket.id,
                    room,
                    joinedAt: new Date(),
                    isOnline: true
                });
                console.log('[USER] Đã lưu user vào memory:', trimmedUsername);
            }
            
            socket.join(room);
            
            // Thông báo thành công
            socket.emit('registration-success', {
                username: trimmedUsername,
                room: room
            });
            
            // Thông báo có người mới vào phòng
            socket.broadcast.to(room).emit('user-joined', {
                username: trimmedUsername,
                message: `${trimmedUsername} đã tham gia phòng chat`,
                timestamp: new Date()
            });
            
            // Gửi lại danh sách user online
            await updateUsersList(room);
            
            console.log(`[USER] ${trimmedUsername} đã tham gia phòng ${room}`);
            
        } catch (error) {
            console.error('[SOCKET] Lỗi đăng ký user:', error);
            socket.emit('registration-error', 'Lỗi server, vui lòng thử lại');
        }
    });
    
    // Xử lý gửi tin nhắn
    socket.on('send-message', async (data) => {
        try {
            let user;
            
            if (mongoose.connection.readyState === 1) {
                user = await User.findOne({ socketId: socket.id, isOnline: true });
            } else {
                user = memoryStorage.users.get(socket.id);
            }
            
            if (!user) {
                socket.emit('message-error', 'Bạn cần đăng ký trước khi gửi tin nhắn');
                return;
            }
            
            const { message, room = user.room } = data;
            
            if (!message || message.trim().length === 0) {
                return;
            }
            
            const messageData = {
                id: Date.now() + Math.random(),
                username: user.username,
                message: message.trim(),
                timestamp: new Date(),
                room: room,
                socketId: socket.id
            };
            
            // Lưu tin nhắn
            if (mongoose.connection.readyState === 1) {
                const newMessage = new Message(messageData);
                await newMessage.save();
                messageData.id = newMessage._id;
                
                // Cập nhật lastActive
                await User.updateOne(
                    { socketId: socket.id },
                    { lastActive: new Date() }
                );
            } else {
                memoryStorage.messages.push(messageData);
                // Giữ chỉ 100 tin nhắn gần nhất trong memory
                if (memoryStorage.messages.length > 100) {
                    memoryStorage.messages = memoryStorage.messages.slice(-100);
                }
            }
            
            // Gửi tin nhắn đến tất cả users trong phòng
            io.to(room).emit('receive-message', messageData);
            
            console.log(`[MESSAGE] ${user.username}: ${message.substring(0, 50)}...`);
            
        } catch (error) {
            console.error('[SOCKET] Lỗi gửi tin nhắn:', error);
            socket.emit('message-error', 'Không thể gửi tin nhắn');
        }
    });
    
    // Xử lý ngắt kết nối
    socket.on('disconnect', async () => {
        try {
            let user;
            
            if (mongoose.connection.readyState === 1) {
                user = await User.findOne({ socketId: socket.id });
                if (user) {
                    await User.updateOne(
                        { socketId: socket.id },
                        { isOnline: false, lastActive: new Date() }
                    );
                }
            } else {
                user = memoryStorage.users.get(socket.id);
                if (user) {
                    memoryStorage.users.delete(socket.id);
                }
            }
            
            if (user) {
                // Thông báo user đã rời khỏi phòng
                socket.broadcast.to(user.room).emit('user-left', {
                    username: user.username,
                    message: `${user.username} đã rời khỏi phòng chat`,
                    timestamp: new Date()
                });
                
                // Cập nhật danh sách user online
                await updateUsersList(user.room);
                
                console.log(`[USER] ${user.username} đã rời khỏi phòng ${user.room}`);
            }
        } catch (error) {
            console.error('[SOCKET] Lỗi xử lý disconnect:', error);
        }
        
        console.log('[SOCKET] Người dùng đã ngắt kết nối:', socket.id);
    });
    
    // Xử lý typing indicator
    socket.on('typing', async (data) => {
        try {
            let user;
            
            if (mongoose.connection.readyState === 1) {
                user = await User.findOne({ socketId: socket.id, isOnline: true });
            } else {
                user = memoryStorage.users.get(socket.id);
            }
            
            if (user) {
                socket.broadcast.to(user.room).emit('user-typing', {
                    username: user.username,
                    isTyping: data.isTyping
                });
            }
        } catch (error) {
            console.error('[SOCKET] Lỗi typing:', error);
        }
    });
});

// Helper function để cập nhật danh sách users
async function updateUsersList(room) {
    try {
        let onlineUsers;
        
        if (mongoose.connection.readyState === 1) {
            onlineUsers = await User.find({ 
                room: room, 
                isOnline: true 
            }).select('username joinedAt').sort({ joinedAt: -1 });
        } else {
            onlineUsers = Array.from(memoryStorage.users.values())
                .filter(u => u.room === room && u.isOnline)
                .map(u => ({ username: u.username, joinedAt: u.joinedAt }))
                .sort((a, b) => b.joinedAt - a.joinedAt);
        }
        
        io.to(room).emit('users-update', onlineUsers);
    } catch (error) {
        console.error('[HELPER] Lỗi cập nhật users list:', error);
    }
}

// Khởi động server
async function startServer() {
    const PORT = process.env.PORT || 10000;
    
    // Thử kết nối MongoDB (không bắt buộc)
    await connectMongoDB();
    
    server.listen(PORT, () => {
        console.log(`[SERVER] Máy chủ đang chạy tại cổng ${PORT}`);
        console.log(`[SERVER] MongoDB Status: ${mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected - Using Memory Storage'}`);
    });
}

// Cleanup offline users (chỉ chạy nếu có MongoDB)
setInterval(async () => {
    if (mongoose.connection.readyState === 1) {
        try {
            const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
            await User.updateMany(
                { lastActive: { $lt: fiveMinutesAgo }, isOnline: true },
                { isOnline: false }
            );
        } catch (error) {
            console.error('[CLEANUP] Lỗi cleanup users:', error);
        }
    }
}, 5 * 60 * 1000);

// Error handling
process.on('unhandledRejection', (reason, promise) => {
    console.error('[ERROR] Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('[ERROR] Uncaught Exception:', error);
    process.exit(1);
});

// Khởi động server
startServer();