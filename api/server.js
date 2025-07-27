const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- KẾT NỐI DATABASE ---
// Vercel sẽ dùng biến môi trường bạn cung cấp
const dbURI = process.env.DB_URI;

mongoose.connect(dbURI)
  .then(() => console.log('[DATABASE] Đã kết nối thành công tới MongoDB!'))
  .catch(err => console.error(`[DATABASE ERROR]`, err));

// --- CẤU HÌNH EXPRESS ---
// Phục vụ các file tĩnh trong thư mục 'public'
app.use(express.static(path.join(__dirname, '../public')));

// --- LOGIC SOCKET.IO ---
// ⚠️ LƯU Ý: Socket.IO và các kết nối thời gian thực có thể không hoạt động ổn định
// trên gói miễn phí của Vercel do bản chất của Serverless Functions.
io.on('connection', (socket) => {
    console.log(`[CONNECT] User ${socket.id} đã kết nối.`);

    socket.on('join', (username) => {
        if (!username) return;
        socket.username = username;
        console.log(`[JOIN] User ${username} (id: ${socket.id}) đã tham gia.`);
        // Logic còn lại của bạn ở đây...
    });

    socket.on('chat message', (data) => {
        if (!socket.username || !data.room) return;
        console.log(`[MESSAGE] Từ ${socket.username} trong phòng ${data.room}: ${data.content}`);
        io.to(data.room).emit('chat message', { user: socket.username, content: data.content });
        // Logic lưu vào DB của bạn ở đây...
    });

    socket.on('disconnect', () => {
        if (socket.username) {
            console.log(`[DISCONNECT] User ${socket.username} (${socket.id}) đã ngắt kết nối.`);
            // Logic còn lại của bạn ở đây...
        }
    });
});

// --- EXPORT APP CHO VERCEL ---
// KHÔNG dùng app.listen() nữa.
// Thay vào đó, chúng ta export server để Vercel xử lý.
module.exports = server;