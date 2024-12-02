import {
  Keypair,
  Connection,
  PublicKey
} from '@solana/web3.js'
import {
  RPC_ENDPOINT,
  RPC_WEBSOCKET_ENDPOINT,
  TOKEN_MINT,
} from './constants'
import base58 from 'bs58'
import { execute } from './legacy'
import { getBuyTransaction, getSellTransaction } from './swap'
import { getAssociatedTokenAddress } from '@solana/spl-token'
import { readFileSync, writeFileSync } from 'fs'

export const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT, commitment: "confirmed"
})

const getAllWallet = () => {
  const wallets = readFileSync('wallets.json')?.toString()

  if (wallets) {
    return JSON.parse(wallets) as string[]
  } else {
    writeFileSync('wallets.json', JSON.stringify([]))

    return []
  }
}

const main = async () => {
  const privateKeys = getAllWallet()

  if (privateKeys.length == 0) {
    console.log("No wallets to defined")

    return
  }

  const wallets = privateKeys.map((privateKey: string) => Keypair.fromSecretKey(base58.decode(privateKey)))
  const actions = [] as (() => Promise<void>)[]

  for (const wallet of wallets) {
    actions.push(async () => {
      const publicKey = wallet.publicKey.toBase58()

      try {
        console.log(`Start buying for wallet ${publicKey}`)
        await buy(wallet, new PublicKey(TOKEN_MINT), 60_000_000)
      } catch (error) {
        console.log(`Error buying token ${publicKey}: ${error}`)
      }

      try {
        console.log(`Start selling for wallet ${publicKey}`)
        await sell(new PublicKey(TOKEN_MINT), wallet)
      } catch (error) {
        console.log(`Error selling token ${publicKey}: ${error}`)
      }
    })
  }

  for (const action of actions) {
    await action()
  }
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
