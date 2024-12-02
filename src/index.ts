import {
  Keypair,
  Connection,
  PublicKey
} from '@solana/web3.js'
import {
  PRIVATE_KEY,
  RPC_ENDPOINT,
  RPC_WEBSOCKET_ENDPOINT,
  TOKEN_MINT,
} from './constants'
import base58 from 'bs58'
import { execute } from './legacy'
import { getBuyTransaction, getSellTransaction } from './swap'
import { getAssociatedTokenAddress } from '@solana/spl-token'

export const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT, commitment: "confirmed"
})

export const wallet = Keypair.fromSecretKey(base58.decode(PRIVATE_KEY))

const main = async () => {
  await buy(wallet, new PublicKey(TOKEN_MINT), 10_000_000)
  await sell(new PublicKey(TOKEN_MINT), wallet)
}

const buy = async (newWallet: Keypair, baseMint: PublicKey, buyAmount: number) => {
  let solBalance: number = 0
  try {
    solBalance = await connection.getBalance(newWallet.publicKey)
  } catch (error) {
    console.log("Error getting balance of wallet")
    return null
  }
  if (solBalance == 0) {
    return null
  }
  try {
    let buyTx = await getBuyTransaction(newWallet, baseMint, buyAmount)
    if (buyTx == null) {
      console.log(`Error getting buy transaction`)
      return null
    }
    
    const latestBlockhash = await connection.getLatestBlockhash()
    const txSig = await execute(buyTx, latestBlockhash, 1)
      
    if (txSig) {
      const tokenBuyTx = txSig ? `https://solscan.io/tx/${txSig}` : ''
      console.log("Success in buy transaction: ", tokenBuyTx)
      return tokenBuyTx
    } else {
      return null
    }
  } catch (error) {
    return null
  }
}

const sell = async (baseMint: PublicKey, wallet: Keypair) => {
  try {
    const tokenAta = await getAssociatedTokenAddress(baseMint, wallet.publicKey)
    const tokenBalInfo = await connection.getTokenAccountBalance(tokenAta)
    if (!tokenBalInfo) {
      console.log("Balance incorrect")
      return null
    }
    const tokenBalance = tokenBalInfo.value.amount

    try {
      let sellTx = await getSellTransaction(wallet, baseMint, tokenBalance)

      if (sellTx == null) {
        console.log(`Error getting buy transaction`)
        return null
      }
      
      const latestBlockhash = await connection.getLatestBlockhash()
      const txSig = await execute(sellTx, latestBlockhash, 1)
      
      if (txSig) {
        const tokenSellTx = txSig ? `https://solscan.io/tx/${txSig}` : ''
        console.log("Success in sell transaction: ", tokenSellTx)
        return tokenSellTx
      } else {
        return null
      }
    } catch (error) {
      return null
    }
  } catch (error) {
    return null
  }
}

main()
