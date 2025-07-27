const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Kết nối MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/chatapp', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
});

mongoose.connection.on('connected', () => {
    console.log('[DATABASE] Đã kết nối thành công tới MongoDB!');
});

mongoose.connection.on('error', (err) => {
    console.log('[DATABASE] Lỗi kết nối MongoDB:', err);
});

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

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Phục vụ file static
app.use(express.static(path.join(__dirname, 'public')));

// Route chính
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Route API (thêm các route API của bạn ở đây)
app.get('/api/test', (req, res) => {
    res.json({ message: 'API hoạt động bình thường!' });
});

// Xử lý 404 cho các route không tồn tại
app.use((req, res) => {
    console.log(`[404] Không tìm thấy: ${req.url}`);
    res.status(404).json({ error: 'Trang không tồn tại' });
});

// Socket.IO
io.on('connection', (socket) => {
    console.log('[SOCKET] Người dùng đã kết nối:', socket.id);
    
    socket.on('disconnect', () => {
        console.log('[SOCKET] Người dùng đã ngắt kết nối:', socket.id);
    });
    
    // Thêm các event handler khác của chat app
    socket.on('join-room', (room) => {
        socket.join(room);
        console.log(`[SOCKET] User ${socket.id} joined room ${room}`);
    });
    
    socket.on('send-message', (data) => {
        socket.to(data.room).emit('receive-message', data);
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`[SERVER] Máy chủ đang chạy tại cổng ${PORT}`);
});