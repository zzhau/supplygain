import { Connex } from "@vechain/connex"
import { Certificate } from "thor-devkit"
import { WalletSource, NetworkInfo, Network } from "../model/enums"
import { SignClient as Client } from "@walletconnect/sign-client/dist/types/client"
import { SignClient } from "@walletconnect/sign-client"
import { Web3Modal } from "@web3modal/standalone"
import { ActionType, useWallet } from "../context/walletContext"

const SUPPORTED_CHAINS = ["vechain:100009", "vechain:100010"]
const web3Modal = new Web3Modal({
  walletConnectVersion: 2,
  projectId: "8ffdf00680a52b1fe25940ea8b29853c",
  standaloneChains: SUPPORTED_CHAINS,
  themeVariables: {
    "--w3m-z-index": "99999999",
  },
})

let connex: Connex | undefined
let signClient: Client | undefined
let session: any

const initialise = (walletSource: WalletSource, network: Network) => {
  const enhancedNetwork = NetworkInfo[network]
  console.log(walletSource, network, enhancedNetwork)
  connex = new Connex({
    node: enhancedNetwork.url,
    network,
    noExtension: walletSource === WalletSource.SYNC2,
  })

  return connex
}

const getConnex = () => {
  if (!connex) throw new Error("Connex not initialised")

  return connex
}

const clear = () => {
  connex = undefined
  signClient = undefined
  session = undefined
}

export const connectToWalletHandler = async (
  source: WalletSource,
  network: Network
): Promise<Certificate> => {
  let cert: Certificate | undefined

  if (source === WalletSource.WALLET_CONNECT) {
    const signClient: Client = await createClient()

    await subscribeToEvents(signClient)
    if (!signClient) throw Error("Cannot connect. Sign Client is not created")

    const { uri, approval } = await signClient.connect({
      requiredNamespaces: {
        vechain: {
          methods: ["delegate_transaction", "identify"],
          chains: [
            network === Network.MAIN ? "vechain:100009" : "vechain:100010",
          ],
          events: ["connect", "disconnect", "accountsChanged"],
        },
      },
    })

    if (uri) {
      web3Modal.openModal({
        uri,
        standaloneChains: [
          network === Network.MAIN ? "vechain:100009" : "vechain:100010",
        ],
      })

      session = await approval()
      console.log("Approval received", session)
      web3Modal.closeModal()

      const message: Connex.Vendor.CertMessage = {
        purpose: "identification",
        payload: {
          type: "text",
          content: "Sign a certificate to prove your identity",
        },
      }

      console.log(
        "Asking wallet to sign the message and identify itself",
        message
      )

      const result: Connex.Vendor.CertResponse = await signClient.request({
        topic: session.topic,
        chainId: network === Network.MAIN ? "vechain:100009" : "vechain:100010",
        request: {
          method: "identify",
          params: [message],
        },
      })

      console.log("Wallet response", result)
      cert = {
        purpose: message.purpose,
        payload: message.payload,
        domain: result.annex.domain,
        timestamp: result.annex.timestamp,
        signer: result.annex.signer,
        signature: result.signature,
      }
    }
  } else {
    const connex = initialise(source, network)

    const message: Connex.Vendor.CertMessage = {
      purpose: "identification",
      payload: {
        type: "text",
        content: "Sign a certificate to prove your identity",
      },
    }

    const certResponse = await connex.vendor.sign("cert", message).request()

    cert = {
      purpose: message.purpose,
      payload: message.payload,
      domain: certResponse.annex.domain,
      timestamp: certResponse.annex.timestamp,
      signer: certResponse.annex.signer,
      signature: certResponse.signature,
    }
  }

  if (!cert) throw new Error("No cert returned")

  console.log("Signed cert", cert)
  Certificate.verify(cert)
  console.log("Cert verified")

  return cert
}

const getAccount = async (
  accountAddress: string
): Promise<Connex.Thor.Account> => {
  const connex = getConnex()
  const account = await connex.thor.account(accountAddress).get()
  return account
}

const createClient = async () => {
  signClient = await SignClient.init({
    logger: "debug",
    relayUrl: "wss://relay.walletconnect.com",
    projectId: "8ffdf00680a52b1fe25940ea8b29853c",
    metadata: {
      name: "Official VeWorld Demo Dapp",
      description:
        "You can use this dapp to familiarize and know more about creation on VeChain",
      url: "https://your_app_url.com/",
      icons: ["https://avatars.githubusercontent.com/u/37784886"],
    },
  })
  return signClient
}

const getSignClient = () => {
  return signClient
}

const getSession = () => {
  return session
}

async function subscribeToEvents(client: Client) {
  if (!client)
    throw Error("No events to subscribe to b/c the client does not exist")

  try {
    client.on("session_delete", () => {
      console.log("user disconnected the session from their wallet")
      const { dispatch } = useWallet()
      dispatch({ type: ActionType.CLEAR })
      clear()
    })
  } catch (e) {
    console.log(e)
  }
}

export default {
  getConnex,
  getAccount,
  initialise,
  clear,
  getSignClient,
  getSession,
}
