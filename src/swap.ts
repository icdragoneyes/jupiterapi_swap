import {
  PublicKey,
  Keypair,
  VersionedTransaction
} from '@solana/web3.js';
import { SLIPPAGE } from './constants';

export const getBuyTransaction = async (wallet: Keypair, token: PublicKey, amount: number) => {
  try {
    const quote = await (await fetch(
      `https://quote-api.jup.ag/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${token.toBase58()}&amount=${amount}&slippageBps=${SLIPPAGE}`
    )).json();

    const { swapTransaction } = await (
      await fetch("https://quote-api.jup.ag/v6/swap", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey: wallet.publicKey.toString(),
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: 100000
        }),
      })
    ).json();

    if (!swapTransaction) {
      console.log("Failed to get buy transaction")
      return null
    }

    const swapTransactionBuf = Buffer.from(swapTransaction, "base64");
    const transaction = VersionedTransaction.deserialize(swapTransactionBuf);

    transaction.sign([wallet]);

    return transaction
  } catch (error) {
    console.log(`Failed to get buy transaction`, error)
    return null
  }
};


export const getSellTransaction = async (wallet: Keypair, token: PublicKey, amount: string) => {
  try {
    const quote = await (
      await fetch(
        `https://quote-api.jup.ag/v6/quote?inputMint=${token.toBase58()}&outputMint=So11111111111111111111111111111111111111112&amount=${amount}&slippageBps=${SLIPPAGE}`
      )
    ).json();

    const { swapTransaction } = await (
      await fetch("https://quote-api.jup.ag/v6/swap", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey: wallet.publicKey.toString(),
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: 52000
        }),
      })
    ).json();

    if (!swapTransaction) {
      console.log("Failed to get sell transaction")
      return null
    }

    const swapTransactionBuf = Buffer.from(swapTransaction, "base64");
    const transaction = VersionedTransaction.deserialize(swapTransactionBuf);

    transaction.sign([wallet]);

    return transaction
  } catch (error) {
    console.log("Failed to get sell transaction", error)
    return null
  }
};
