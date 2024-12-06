const { Keypair } = require('@solana/web3.js');
const { PublicKey } = require('@solana/web3.js');
const { Connection } = require('@solana/web3.js');
const base58 = require('bs58');
const { readFileSync, unlinkSync, writeFileSync } = require('fs');

const connection = new Connection('https://api.mainnet-beta.solana.com', {
  wsEndpoint: 'wss://api.mainnet-beta.solana.com',
  commitment: 'confirmed',
});

const tokenProgramId = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const associatedTokenProgramId = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const token = new PublicKey('33a14qXWo1MB7uXtTh5ifyvox7FdGRPQbsws41gfpump');

/**
 *
 * @param {PublicKey} wallet
 */
const getTokenBalance = async (wallet) => {
  const [contract] = PublicKey.findProgramAddressSync(
    [wallet.toBuffer(), tokenProgramId.toBuffer(), token.toBuffer()],
    associatedTokenProgramId,
  );

  const info = await connection.getTokenAccountBalance(contract);

  if (!info) {
    return 0;
  }

  return Number(info.value.uiAmount || 0);
};

const main = async () => {
  const keys = JSON.parse(readFileSync('wallets.json').toString());
  const wallets = keys.map((key) => Keypair.fromSecretKey(base58.decode(key)));
  const data = [];

  for (const wallet of wallets) {
    const publicKey = wallet.publicKey.toBase58();
    const privateKey = base58.encode(wallet.secretKey);
    const balance = (await connection.getBalance(wallet.publicKey)) / 1_000_000_000;
    const amount = await getTokenBalance(wallet.publicKey);

    data.push({ publicKey, privateKey, balance, amount });

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  try {
    unlinkSync('wallets.csv');
  } catch (e) {}

  let s = `publicKey,privateKey,balance,amount\n`;

  for (const item of data) {
    s += `${item.publicKey},${item.privateKey},${item.balance},${item.amount}\n`;
  }

  writeFileSync('wallets.csv', s);
};

main();
