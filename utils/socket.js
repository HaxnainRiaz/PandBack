let io;

const noopEmitter = {
    emit() {},
    on() { return this; },
    to() { return this; }
};

module.exports = {
    init: (httpServer) => {
        io = require('socket.io')(httpServer, {
            cors: {
                origin: "*",
                methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
                credentials: true
            }
        });
        return io;
    },
    getIO: () => {
        if (!io) {
            return noopEmitter;
        }
        return io;
    }
};
