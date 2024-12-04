import { Keypair } from "@solana/web3.js";
import base58 from "bs58";
import { readFileSync, writeFileSync } from 'node:fs'

export const file = 'wallets.json'

export function store(wallet: Keypair) {
  const read = readFileSync(file)?.toString()
  const data = (read ? JSON.parse(read) : []) as string[]

  data.push(base58.encode(wallet.secretKey))

  writeFileSync(file, JSON.stringify(data, null, 2))
}

export default { store }
