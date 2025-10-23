// src/services/notification.service.js
import { messaging } from "../config/firebase.js";

export const sendOTPNotification = async (token, otp) => {
    try {
        const message = {
            notification: {
                title: 'Your OTP Code',
                body: `Your OTP code is ${otp}`
            },
            token: token
        };

        const response = await messaging.send(message);
        console.log('Successfully sent message:', response);
        return response;
    } catch (error) {
        console.log('Error sending message:', error);
        throw error;
    }
};