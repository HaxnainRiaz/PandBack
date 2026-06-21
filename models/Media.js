const mongoose = require('mongoose');

const MediaSchema = new mongoose.Schema({
    filename: {
        type: String,
        required: true,
        unique: true
    },
    data: {
        type: Buffer,
        required: true
    },
    contentType: {
        type: String,
        required: true
    },
    size: {
        type: Number
    },
    uploadDate: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Media', MediaSchema);
