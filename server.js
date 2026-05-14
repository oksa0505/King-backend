const express = require('express');
const cors = require('cors');
const db = require('./db');
const blockchain = require('./blockchain');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Start listening to blockchain events
blockchain.startListening();

// GET /king -> current king address + position size
app.get('/king', (req, res) => {
    const kingAddress = db.getCurrentKing();
    if (!kingAddress) {
        return res.json({ currentKing: null, balance: '0' });
    }
    const holder = db.getHolder(kingAddress);
    res.json({
        currentKing: kingAddress,
        balance: holder ? holder.balance : '0'
    });
});

// GET /fees -> total fees collected, 80% share, 20% share, total burned
app.get('/fees', (req, res) => {
    const stats = db.getStats();
    const totalFees = stats['total_fees'] || '0';
    const totalBurned = stats['total_burned'] || '0';
    
    // Calculate shares roughly
    const tfBig = BigInt(totalFees);
    const kingShare = (tfBig * 80n) / 100n;
    const burnShare = tfBig - kingShare;

    res.json({
        totalFees: totalFees.toString(),
        totalBurned: totalBurned.toString(),
        kingShare: kingShare.toString(),
        burnShare: burnShare.toString()
    });
});

// GET /leaderboard -> top 10 holders ranked by size
app.get('/leaderboard', (req, res) => {
    const topHolders = db.getTopHolders(10);
    res.json(topHolders);
});

// GET /history -> past kings with duration and earnings
app.get('/history', (req, res) => {
    const history = db.getHistory();
    res.json(history);
});

app.listen(port, () => {
    console.log(`King of the Hill indexer listening at http://localhost:${port}`);
});
