import { ApolloClient, NormalizedCacheObject } from '@apollo/client'
import {
  AuthenticatedClient,
  createAuthenticatedClient
} from '@interledger/open-payments'
import { AccountProvider, setupFromSeed } from 'mock-account-servicing-lib'
import { createApolloClient } from './apolloClient'
import { WebhookServer } from './WebhookServer'
import { TestConfig } from './config'

/** Mock Account Servicing Entity */
export class MockASE {
  private config: TestConfig
  private apolloClient: ApolloClient<NormalizedCacheObject>
  public accounts: AccountProvider
  public opClient!: AuthenticatedClient
  public webhookServer: WebhookServer

  // Use .create factory because async construction
  public static async create(config: TestConfig): Promise<MockASE> {
    const mase = new MockASE(config)
    await mase.initAsync()
    return mase
  }

  // Private to ensure it doesnt get called directly.
  // Use static MockASE.create instead.
  private constructor(config: TestConfig) {
    this.config = config
    this.apolloClient = createApolloClient(config.graphqlUrl)
    this.accounts = new AccountProvider()
    this.webhookServer = new WebhookServer(this.apolloClient, this.accounts)
    this.webhookServer.start(this.config.webhookServerPort)
  }

  private async initAsync() {
    await setupFromSeed(this.config, this.apolloClient, this.accounts)

    this.opClient = await createAuthenticatedClient({
      privateKey: this.config.key,
      keyId: this.config.keyId,
      walletAddressUrl: this.config.walletAddressUrl
    })
  }

  public async shutdown() {
    await this.webhookServer.close()
  }
}
