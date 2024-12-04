import {
  Keypair,
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction
} from '@solana/web3.js'
import {
  RPC_ENDPOINT,
  RPC_WEBSOCKET_ENDPOINT,
  TOKEN_MINT,
} from './constants'
import base58 from 'bs58'
import * as legacy from './legacy'
import db from './db'
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

const generateNewWallet = async (wallet: Keypair, old?: Keypair): Promise<Keypair | undefined> => {
  const balance = await connection.getBalance(wallet.publicKey)
  
  if (balance <= 60_000_000 * 2) {
    console.log(`Wallet ${wallet.publicKey.toBase58()} balance ${balance} is not enough`)

    return
  }

  const lamports = Math.floor(balance - 1_000_000)
  const generated = old !== undefined ? old : Keypair.generate()

  if (!old) {
    console.log({
      publicKey: generated.publicKey.toBase58(),
      privateKey: base58.encode(generated.secretKey),
    })
    db.store(generated)
  }

  const instructions = []

  instructions.push(SystemProgram.transfer({
    fromPubkey: wallet.publicKey,
    toPubkey: generated.publicKey,
    lamports,
  }))

  const transactions = new Transaction().add(...instructions)
  const latestBlockhash = await connection.getLatestBlockhash()

  transactions.feePayer = wallet.publicKey
  transactions.recentBlockhash = latestBlockhash.blockhash

  const message = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: latestBlockhash.blockhash,
    instructions,
  }).compileToV0Message()

  const transaction = new VersionedTransaction(message)

  transaction.sign([wallet])

  try {
    console.log('creating new wallet')
    await legacy.execute(transaction, 1, latestBlockhash)
  } catch (e) {
    await new Promise((resolve) => setTimeout(resolve, 1000))

    return await generateNewWallet(wallet, generated)
  }

  return generated
}

const run = async (generate: boolean = true) => {
  const privateKeys = getAllWallet()

  if (privateKeys.length == 0) {
    console.log("No wallets to defined")

    return
  }

  const wallets = privateKeys.map((privateKey: string) => Keypair.fromSecretKey(base58.decode(privateKey)))
  const actions = [] as ([() => Promise<void>, () => Promise<void>])[]

  for (const wallet of wallets) {
    const balance = await connection.getBalance(wallet.publicKey)

    if (balance <= 60_000_000 * 2) {
      console.log(`Wallet ${wallet.publicKey.toBase58()} balance ${balance} is not enough`)

      continue
    }

    actions.push([
      async () => {
        const value = amount()
  
        try {
          console.log(`Start buying for wallet ${wallet.publicKey} with amount ${value}`)
          await buy(wallet, new PublicKey(TOKEN_MINT), value)
        } catch (error) {
          console.log(`Error buying token ${wallet.publicKey}: ${error}`)
        }
      },
      async () => {
        try {
          console.log(`Start selling for wallet ${wallet.publicKey}`)
          await sell(new PublicKey(TOKEN_MINT), wallet)
        } catch (error) {
          console.log(`Error selling token ${wallet.publicKey}: ${error}`)
        }
      }
    ])
  }

  if (wallets.length == 0) {
    console.log("No wallets have enough balance")

    return
  }

  const swaps = [] as (() => Promise<void>)[]

  for (let i = 0; i < 10; i++) {
    for (const [buying, selling] of actions) {
      await buying()
      
      const swap = swaps.shift()

      if (swap) {
        await swap()
      }

      swaps.push(selling)
    }

    for (const swap of [...swaps]) {
      swaps.shift()

      await swap()
    }
  }

  for (const wallet of wallets) {
    const balance = await connection.getBalance(wallet.publicKey)

    if (balance <= 60_000_000 * 2) {
      continue
    }

    const value = amount()

    try {
      console.log(`Start buying for wallet ${wallet.publicKey} with amount ${value}`)
      await buy(wallet, new PublicKey(TOKEN_MINT), value)
    } catch (error) {
      console.log(`Error buying token ${wallet.publicKey}: ${error}`)
    }

    try {
      console.log(`Start selling for wallet ${wallet.publicKey} with hold 0.5%`)
      await sell(new PublicKey(TOKEN_MINT), wallet, 0.005)
      console.log('Sell success')
    } catch (error) {
      console.log(`Error selling token ${wallet.publicKey}: ${error}`)
    }
  }

  if (generate) {
    for (const wallet of wallets) {
      await generateNewWallet(wallet)
    }
  }
}

const buy = async (wallet: Keypair, token: PublicKey, amount: number) => {
  let solBalance: number = 0
  try {
    solBalance = await connection.getBalance(wallet.publicKey)
  } catch (error) {
    console.log("Error getting balance of wallet")
    return null
  }
  if (solBalance == 0) {
    return null
  }

  try {
    let buyTx = await getBuyTransaction(wallet, token, amount)
    if (buyTx == null) {
      console.log(`Error getting buy transaction`)
      return null
    }
    
    // const latestBlockhash = await connection.getLatestBlockhash()
    try {
      const txSig = await legacy.execute(buyTx, 1)

      if (txSig) {
        // const tokenBuyTx = txSig ? `https://solscan.io/tx/${txSig}` : ''
        // console.log("Success in buy transaction: ", tokenBuyTx)
        return null
      } else {
        return null
      }
    } catch (e) {
      await buy(wallet, token, amount)

      return null
    }
  } catch (error) {
    return null
  }
}

const sell = async (token: PublicKey, wallet: Keypair, hold: number = 0) => {
  try {
    const tokenAta = await getAssociatedTokenAddress(token, wallet.publicKey)
    const tokenBalInfo = await connection.getTokenAccountBalance(tokenAta)
    if (!tokenBalInfo) {
      console.log("Balance incorrect")
      return null
    }
    let tokenBalance = Number(tokenBalInfo.value.amount)

    if (hold > 0) {
      tokenBalance -= Math.floor(tokenBalance * hold)
    }

    if (Math.floor(tokenBalance) <= 0) {
      return null
    }

    try {
      let sellTx = await getSellTransaction(wallet, token, tokenBalance)

      if (sellTx == null) {
        console.log(`Error getting buy transaction`)
        return null
      }
      
      try {
        const txSig = await legacy.execute(sellTx, 1)
        if (txSig) {
          // const tokenSellTx = txSig ? `https://solscan.io/tx/${txSig}` : ''
          // console.log("Success in sell transaction: ", tokenSellTx)
          return null
        } else {
          return null
        }
      } catch (e) {
        await sell(token, wallet, hold)

        return null
      }
    } catch (error) {
      return null
    }
  } catch (error) {
    return null
  }
}

const main = async () => {
  for (let i = 0; i < 20; i++) {
    await run()
  }

  while (true) {
    await run(false)
  }
}

main()
