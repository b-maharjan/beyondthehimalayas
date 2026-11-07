const rateLimits = new Map();
const rateWindowMs = 10 * 60 * 1000;
const maxRequestsPerWindow = 3;
const allowedTopics = new Set(['Question', 'Suggestion', 'Feedback']);

module.exports = async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');

    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Method not allowed.' });
    }

    if (!process.env.RESEND_API_KEY || !process.env.FEEDBACK_TO || !process.env.FEEDBACK_FROM) {
        return res.status(503).json({ error: 'The feedback form is not configured yet. Please try again later.' });
    }

    const origin = req.headers.origin;
    if (origin) {
        try {
            if (new URL(origin).host !== req.headers.host) {
                return res.status(403).json({ error: 'Request not allowed.' });
            }
        } catch {
            return res.status(403).json({ error: 'Request not allowed.' });
        }
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (typeof body.website === 'string' && body.website.trim()) {
        return res.status(200).json({ message: 'Thanks for your message.' });
    }

    const topic = typeof body.topic === 'string' ? body.topic : '';
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim() : '';

    if (!allowedTopics.has(topic) || message.length < 3 || message.length > 2000) {
        return res.status(400).json({ error: 'Choose a topic and enter a message of 3 to 2000 characters.' });
    }

    if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
        return res.status(400).json({ error: 'Enter a valid email address or leave it blank.' });
    }

    const forwardedFor = req.headers['x-forwarded-for'];
    const clientIp = typeof forwardedFor === 'string' ? forwardedFor.split(',')[0].trim() : 'unknown';
    const now = Date.now();
    const limit = rateLimits.get(clientIp);

    if (!limit || now - limit.start >= rateWindowMs) {
        rateLimits.set(clientIp, { start: now, count: 1 });
    } else if (limit.count >= maxRequestsPerWindow) {
        return res.status(429).json({ error: 'Too many messages. Please try again later.' });
    } else {
        limit.count += 1;
    }

    const emailPayload = {
        from: process.env.FEEDBACK_FROM,
        to: [process.env.FEEDBACK_TO],
        subject: `[Blog Nepal] ${topic}`,
        text: `Topic: ${topic}\n\n${message}`
    };

    if (email) {
        emailPayload.reply_to = email;
    }

    try {
        const resendResponse = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(emailPayload)
        });

        if (!resendResponse.ok) {
            return res.status(502).json({ error: 'Could not send your message right now. Please try again later.' });
        }

        return res.status(200).json({ message: 'Thanks for your message. It has been sent.' });
    } catch {
        return res.status(502).json({ error: 'Could not send your message right now. Please try again later.' });
    }
};