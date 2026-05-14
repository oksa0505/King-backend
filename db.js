const fs = require('fs');
const path = require('path');

const dbPath = path.resolve(__dirname, 'king_db.json');

// Initialize schema
function readDB() {
    if (!fs.existsSync(dbPath)) {
        return {
            holders: {},
            history: [],
            stats: {
                total_fees: '0',
                total_burned: '0',
                current_king: ''
            }
        };
    }
    try {
        return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    } catch (e) {
        return {
            holders: {},
            history: [],
            stats: {
                total_fees: '0',
                total_burned: '0',
                current_king: ''
            }
        };
    }
}

function writeDB(data) {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
}

module.exports = {
  updateHolderBalance: (address, balance) => {
    const data = readDB();
    data.holders[address] = balance.toString();
    writeDB(data);
  },
  
  getTopHolders: (limit = 10) => {
    const data = readDB();
    const holdersArray = Object.entries(data.holders).map(([address, balance]) => ({
        address,
        balance
    }));
    
    // Sort by BigInt value descending
    holdersArray.sort((a, b) => {
        const bigA = BigInt(a.balance);
        const bigB = BigInt(b.balance);
        if (bigA > bigB) return -1;
        if (bigA < bigB) return 1;
        return 0;
    });

    return holdersArray.slice(0, limit);
  },

  getHolder: (address) => {
    const data = readDB();
    if (data.holders[address] !== undefined) {
        return { address, balance: data.holders[address] };
    }
    return undefined;
  },

  updateCurrentKing: (kingAddress) => {
    const data = readDB();
    data.stats.current_king = kingAddress;
    writeDB(data);
  },

  getCurrentKing: () => {
    const data = readDB();
    return data.stats.current_king || null;
  },

  startReign: (kingAddress, startTime) => {
    const data = readDB();
    const current = data.stats.current_king;
    if (current) {
        // End the previous reign
        const lastReign = data.history[data.history.length - 1];
        if (lastReign && !lastReign.end_time) {
            lastReign.end_time = startTime;
        }
    }
    data.history.push({
        king: kingAddress,
        start_time: startTime,
        end_time: null,
        fees_earned: '0'
    });
    data.stats.current_king = kingAddress;
    writeDB(data);
  },

  addFeesEarned: (kingAddress, amountStr) => {
    const data = readDB();
    for (let i = data.history.length - 1; i >= 0; i--) {
        if (data.history[i].king === kingAddress) {
            const currentFees = BigInt(data.history[i].fees_earned || '0');
            const newFees = currentFees + BigInt(amountStr);
            data.history[i].fees_earned = newFees.toString();
            writeDB(data);
            return;
        }
    }
  },

  getHistory: () => {
    const data = readDB();
    return data.history.slice().reverse();
  },

  addGlobalStats: (key, amountStr) => {
    const data = readDB();
    const current = BigInt(data.stats[key] || '0');
    const next = current + BigInt(amountStr);
    data.stats[key] = next.toString();
    writeDB(data);
  },

  getStats: () => {
    const data = readDB();
    return data.stats;
  }
};
