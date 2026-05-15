const { ethers } = require('ethers');
const db = require('./db');

// In production, load these from environment variables
const RPC_URL = process.env.RPC_URL || 'https://mainnet.base.org';
const PRIVATE_KEY = process.env.PRIVATE_KEY; // For the relayer
const KING_CONTRACT_ADDRESS = process.env.KING_CONTRACT_ADDRESS;
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;
const POOL_ADDRESS = process.env.POOL_ADDRESS; // To prevent the pool from being King

const provider = new ethers.JsonRpcProvider(RPC_URL);
let wallet;
if (PRIVATE_KEY) {
    wallet = new ethers.Wallet(PRIVATE_KEY, provider);
}

// ABIs
const erc20Abi = [
    "event Transfer(address indexed from, address indexed to, uint256 value)",
    "function balanceOf(address account) view returns (uint256)"
];

const kingAbi = [
    "event KingChanged(address indexed newKing, uint256 tokenBalance)",
    "event FeesDistributed(address indexed king, uint256 amount)",
    "event TokensBurned(uint256 ethAmountUsed, uint256 tokensBurned)",
    "event FeesReceived(address indexed sender, uint256 amount)",
    "function updateKing(address contender) external",
    "function distributeFees() external",
    "function accumulatedFees() view returns (uint256)"
];

let tokenContract;
let kingContract;

async function startListening() {
    if (!KING_CONTRACT_ADDRESS || !TOKEN_ADDRESS) {
        console.log("Missing contract addresses in environment.");
        return;
    }

    tokenContract = new ethers.Contract(TOKEN_ADDRESS, erc20Abi, provider);
    kingContract = new ethers.Contract(KING_CONTRACT_ADDRESS, kingAbi, wallet || provider);

    console.log("Listening for blockchain events...");

    // Listen to Token Transfers
    tokenContract.on("Transfer", async (from, to, value, event) => {
        try {
            // Update balances
            const balanceTo = await tokenContract.balanceOf(to);
            db.updateHolderBalance(to, balanceTo.toString());

            if (from !== ethers.ZeroAddress) {
                balanceFrom = await tokenContract.balanceOf(from);
                db.updateHolderBalance(from, balanceFrom.toString());
            }

            // Check if 'to' should be the new king
            await checkAndRelayNewKing(to, balanceTo);
            
            // Also check if 'from' is still bigger and should reclaim/keep the throne!
            if (from !== ethers.ZeroAddress && balanceFrom) {
                await checkAndRelayNewKing(from, balanceFrom);
            }
            
            // Check true top holder in case the King sold their tokens
            const topHolders = db.getTopHolders(5);
            for (const holder of topHolders) {
                if (POOL_ADDRESS && holder.address.toLowerCase() === POOL_ADDRESS.toLowerCase()) {
                    continue;
                }
                await checkAndRelayNewKing(holder.address, holder.balance);
                break;
            }
        } catch (error) {
            console.error("Error processing Transfer:", error);
        }
    });

    // Listen to KingChanged
    kingContract.on("KingChanged", (newKing, balance, event) => {
        console.log("New King:", newKing);
        // Get block timestamp
        event.getBlock().then(block => {
            db.startReign(newKing, block.timestamp);
        });
    });

    // Listen to FeesDistributed
    kingContract.on("FeesDistributed", (king, amount, event) => {
        console.log("Fees Distributed to King:", king, ethers.formatEther(amount));
        db.addFeesEarned(king, amount.toString());
    });

    // Listen to TokensBurned
    kingContract.on("TokensBurned", (ethAmount, tokensBurned, event) => {
        console.log("Tokens Burned:", ethers.formatEther(tokensBurned));
        db.addGlobalStats('total_burned', tokensBurned.toString());
    });

    // Listen to FeesReceived
    kingContract.on("FeesReceived", (sender, amount, event) => {
        console.log("Fees Received:", ethers.formatEther(amount));
        db.addGlobalStats('total_fees', amount.toString());
    });

    // Start auto-distribution loop if we have a wallet
    if (wallet) {
        setInterval(checkAndDistributeFees, 60 * 60 * 1000); // Check every hour
    }
}

// Optional relayer function to distribute fees automatically
async function checkAndDistributeFees() {
    if (!wallet) return;
    try {
        const accumulated = await kingContract.accumulatedFees();
        // Distribute if accumulated > 0.01 ETH (approx to save gas)
        if (accumulated > ethers.parseEther("0.01")) {
            console.log("Auto-distributing accumulated fees:", ethers.formatEther(accumulated));
            const tx = await kingContract.distributeFees();
            await tx.wait();
        }
    } catch (error) {
        console.error("Error auto-distributing fees:", error);
    }
}

// Optional relayer function to update king automatically
async function checkAndRelayNewKing(contender, contenderBalance) {
    if (!wallet) return; // Only relay if we have a wallet

    // VERY IMPORTANT: The Liquidity Pool cannot be the King!
    if (POOL_ADDRESS && contender.toLowerCase() === POOL_ADDRESS.toLowerCase()) {
        console.log("Ignoring Pool Address for King:", contender);
        return;
    }

    const currentKingAddress = db.getCurrentKing();
    if (!currentKingAddress) {
        // No king yet
        try {
            console.log("Relaying initial king update for", contender);
            const tx = await kingContract.updateKing(contender);
            await tx.wait();
        } catch (error) {
            console.error("Relay error (initial):", error);
        }
        return;
    }

    const currentKingData = db.getHolder(currentKingAddress);
    if (!currentKingData) return;

    const currentKingBalance = BigInt(currentKingData.balance);
    if (BigInt(contenderBalance) > currentKingBalance) {
        try {
            console.log("Relaying king update for", contender);
            const tx = await kingContract.updateKing(contender);
            await tx.wait();
        } catch (error) {
            console.error("Relay error:", error);
        }
    }
}

module.exports = {
    startListening
};
