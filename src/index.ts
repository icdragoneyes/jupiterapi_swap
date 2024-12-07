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
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT, commitment: 'processed'
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

function randomArray<T>(array: T[]): T[] {
  const clone = array.slice()

  return clone.sort(() => Math.random() - 0.5)
}

const generateNewWallet = async (wallet: Keypair, old?: Keypair): Promise<Keypair | undefined> => {
  const balance = await connection.getBalance(wallet.publicKey)
  
  if (balance <= 5_000_000) {
    console.log(`Wallet ${wallet.publicKey.toBase58()} balance ${balance} is not enough`)

    await new Promise((resolve) => setTimeout(resolve, 1000))

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

const run = async () => {
  const privateKeys = getAllWallet()

  if (privateKeys.length == 0) {
    console.log("No wallets to defined")

    return
  }

  const pairs = privateKeys.map((privateKey: string) => Keypair.fromSecretKey(base58.decode(privateKey)))
  const wallets = [] as Keypair[]
  const actions = [] as ([() => Promise<void>, () => Promise<void>])[]

  for (const wallet of pairs) {
    const amount = Math.floor(Math.random() * 30_000_000) + 30_000_000
    const balance = (await connection.getBalance(wallet.publicKey)) - 4_000_000

    if (balance < amount) {
      console.log(`Wallet ${wallet.publicKey.toBase58()} balance ${balance + 4_000_000} is not enough`)

      await new Promise((resolve) => setTimeout(resolve, 500))

      continue
    }

    wallets.push(wallet)

    actions.push([
      async () => {
        try {
          console.log(`Start buying for wallet ${wallet.publicKey} with amount ${amount}`)
          await buy(wallet, new PublicKey(TOKEN_MINT), amount)
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

    await sell(new PublicKey(TOKEN_MINT), wallet)
  }

  if (wallets.length == 0) {
    console.log("No wallets have enough balance")

    return
  }

  const swaps = [] as (() => Promise<void>)[]

  for (const [buying, selling] of actions) {
    try {
      await buying()
    } catch (error) {
      console.log(`Error buying token: ${error}`)
    }

    const swap = swaps.shift()

    if (swap) {
      try {
        await swap()
      } catch (error) {
        console.log(`Error swapping token: ${error}`)

        swaps.push(swap)
      }
    }

    swaps.push(selling)
  }

  for (const swap of swaps) {
    try {
      await swap()
    } catch (error) {
      console.log(`Error swapping token: ${error}`)
    }
  }

  const holders = await getTokenHolderCount()

  console.log(`Total holders: ${holders}`)

  // if (holders < 1000) {
  //   for (const wallet of wallets) {
  //     await generateNewWallet(wallet)
  //   }
  // }
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

const getTokenHolderCount = async () => {
  const connection = new Connection('https://wandering-light-sponge.solana-mainnet.quiknode.pro/8fad23df9dae2e832049ac721f6c5ee5166d3e81')
  const publicKey = new PublicKey(TOKEN_MINT)
  
  const holders = await connection.getParsedProgramAccounts(
    new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    {
      filters: [
        {
          dataSize: 165
        },
        {
          memcmp: {
            offset: 0,
            bytes: publicKey.toBase58()
          }
        }
      ]
    }
  )

  const uniqueHolders = new Set()

  for (const { account } of holders) {
    const data = account.data as {
      parsed: {
        info: {
          tokenAmount: {
            amount: string
          },
          owner: PublicKey
        }
      }
    }

    const tokenAmount = Number(data.parsed.info.tokenAmount.amount)

    if (tokenAmount > 0) {
      uniqueHolders.add(data.parsed.info.owner)
    }
  }

  return uniqueHolders.size
}

const main = async () => {
  while (true) {
    await run()

    await new Promise((resolve) => setTimeout(resolve, 60_000))
  }
}

main()
