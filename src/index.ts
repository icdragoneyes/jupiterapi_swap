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

const amount = () => {
  // random from 60_000_000 to 120_000_000
  return Math.floor(Math.random() * 60_000_000) + 60_000_000
}

function randomArray<T>(array: T[]): T[] {
  const clone = array.slice()

  return clone.sort(() => Math.random() - 0.5)
}

const main = async () => {
  const privateKeys = getAllWallet()

  if (privateKeys.length == 0) {
    console.log("No wallets to defined")

    return
  }

  const wallets = privateKeys.map((privateKey: string) => Keypair.fromSecretKey(base58.decode(privateKey)))

  while (true) {
    const buys = [] as (() => Promise<void>)[]
    const sells = [] as (() => Promise<void>)[]
  
    for (const wallet of wallets) {
      const publicKey = wallet.publicKey
      const balance = await connection.getBalance(wallet.publicKey)
  
      console.log(`Wallet ${publicKey.toBase58()} balance ${balance}`)
  
      buys.push(async () => {
        const value = amount()
  
        try {
          console.log(`Start buying for wallet ${publicKey} with amount ${value}`)
          await buy(wallet, new PublicKey(TOKEN_MINT), value)
        } catch (error) {
          console.log(`Error buying token ${publicKey}: ${error}`)
        }
      })
  
      sells.push(async () => {
        try {
          console.log(`Start selling for wallet ${publicKey}`)
          await sell(new PublicKey(TOKEN_MINT), wallet)
        } catch (error) {
          console.log(`Error selling token ${publicKey}: ${error}`)
        }
      })
    }
  
    for (const sell of sells) {
      try {
        await sell()
      } catch (error) {
      }
    }
  
    const buyers = [] as (() => Promise<void>)[]
    
    for (let i = 0; i < buys.length; i++) {
      const buy = buys[i]
      const sell = sells[i]
  
      try {
        await buy()
    
        const willSell = buyers.shift()
    
        if (willSell) {
          try {
            await willSell()
          } catch (error) {
            buyers.unshift(willSell)
          }
        }
        
        buyers.push(sell)
      } catch (error) {
      }
    }
  
    for (const sell of buyers) {
      try {
        await sell()
      } catch (error) {
      }
    }
  
    for (const sell of sells) {
      try {
        await sell()
      } catch (error) {
      }
    }
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

    if (Math.floor(Number(tokenBalance)) <= 0) {
      return null
    }

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
