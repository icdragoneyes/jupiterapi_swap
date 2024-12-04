import { BlockhashWithExpiryBlockHeight, Connection, VersionedTransaction } from "@solana/web3.js";
import { RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT } from "./constants";

export const execute = async (transaction: VersionedTransaction, isBuy: boolean | 1 = true, latestBlockhash?: BlockhashWithExpiryBlockHeight) => {
  const solanaConnection = new Connection(RPC_ENDPOINT, {
    wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
  })
  latestBlockhash = latestBlockhash || await solanaConnection.getLatestBlockhash()
  console.log('sending transaction')
  const signature = await solanaConnection.sendRawTransaction(transaction.serialize(), { skipPreflight: true })
  console.log('confirming transaction')
  const confirmation = await solanaConnection.confirmTransaction({
    signature,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    blockhash: latestBlockhash.blockhash,
  });

  console.log(`https://explorer.solana.com/tx/${signature}`)

  if (confirmation.value.err) {
    throw confirmation.value.err
  } else {
    if(isBuy === 1){
      // console.log(`Success in buy transaction: https://solscan.io/tx/${signature}`)
      return signature
    } else if (isBuy)
      console.log(`Success in buy transaction: https://solscan.io/tx/${signature}`)
    else
      console.log(`Success in Sell transaction: https://solscan.io/tx/${signature}`)
  }
  return signature
}
