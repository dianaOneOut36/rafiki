import { Errors } from 'ilp-packet'
import { AccountAlreadyExistsError } from '../../../../../accounting/errors'
import { LiquidityAccountType } from '../../../../../accounting/service'
import { IncomingPaymentState } from '../../../../../open_payments/payment/incoming/model'
import { validateId } from '../../../../../shared/utils'
import {
  ILPContext,
  ILPMiddleware,
  IncomingAccount,
  OutgoingAccount
} from '../rafiki'
import { AuthState } from './auth'

const UUID_LENGTH = 36

export function createAccountMiddleware(serverAddress: string): ILPMiddleware {
  return async function account(
    ctx: ILPContext<AuthState & { streamDestination?: string }>,
    next: () => Promise<void>
  ): Promise<void> {
    const createLiquidityAccount = async (
      account: IncomingAccount,
      accountType: LiquidityAccountType
    ): Promise<void> => {
      try {
        await ctx.services.accounting.createLiquidityAccount(
          account,
          accountType
        )
        ctx.services.logger.debug(
          { account, accountType },
          'Created liquidity account'
        )
      } catch (err) {
        // Don't complain if liquidity account already exists.
        if (!(err instanceof AccountAlreadyExistsError)) {
          ctx.services.logger.error(
            { account, accountType, err },
            'Failed to create liquidity account'
          )
          throw err
        }
      }
    }

    const { walletAddresses, incomingPayments, peers } = ctx.services
    const incomingAccount = ctx.state.incomingAccount
    if (!incomingAccount) {
      ctx.services.logger.error(
        { state: ctx.state },
        'Unauthorized: No incoming account'
      )
      ctx.throw(401, 'unauthorized')
    }

    const getAccountByDestinationAddress = async (): Promise<
      OutgoingAccount | undefined
    > => {
      if (ctx.state.streamDestination) {
        const incomingPayment = await incomingPayments.get({
          id: ctx.state.streamDestination
        })
        if (incomingPayment) {
          if (
            ctx.request.prepare.amount !== '0' &&
            [
              IncomingPaymentState.Completed,
              IncomingPaymentState.Expired
            ].includes(incomingPayment.state)
          ) {
            const errorMessage = 'destination account is in an incorrect state'
            ctx.services.logger.error(
              {
                incomingPayment,
                streamDestination: ctx.state.streamDestination
              },
              errorMessage
            )
            throw new Errors.UnreachableError(errorMessage)
          }

          // Create the tigerbeetle account if not exists.
          // The incoming payment state will be PENDING until payments are received.
          if (incomingPayment.state === IncomingPaymentState.Pending) {
            await createLiquidityAccount(
              incomingPayment,
              LiquidityAccountType.INCOMING
            )
          }
          ctx.services.logger.debug(
            { incomingPaymentId: incomingPayment.id },
            'destination account is incoming payment'
          )
          return incomingPayment
        }
        // Open Payments SPSP fallback account
        const walletAddress = await walletAddresses.get(
          ctx.state.streamDestination
        )
        if (walletAddress) {
          if (!walletAddress.totalEventsAmount) {
            await createLiquidityAccount(
              walletAddress,
              LiquidityAccountType.WEB_MONETIZATION
            )
          }
          ctx.services.logger.debug(
            { walletAddressId: walletAddress.id },
            'destination account is wallet address'
          )
          return walletAddress
        }
      }
      const address = ctx.request.prepare.destination
      const peer = await peers.getByDestinationAddress(address)
      if (peer) {
        ctx.services.logger.debug(
          { peerId: peer.id },
          'destination account is peer'
        )
        return peer
      }
      if (
        address.startsWith(serverAddress + '.') &&
        (address.length === serverAddress.length + 1 + UUID_LENGTH ||
          address[serverAddress.length + 1 + UUID_LENGTH] === '.')
      ) {
        const accountId = address.slice(
          serverAddress.length + 1,
          serverAddress.length + 1 + UUID_LENGTH
        )
        if (validateId(accountId)) {
          // TODO: Look up direct ILP access account
          // return await accounts.get(accountId)
        }
      }
    }

    const outgoingAccount = await getAccountByDestinationAddress()
    if (!outgoingAccount) {
      const errorMessage = 'unknown destination account'
      ctx.services.logger.error(
        {
          streamDestination: ctx.state.streamDestination,
          destinationAddress: ctx.request.prepare.destination
        },
        errorMessage
      )
      throw new Errors.UnreachableError(errorMessage)
    }
    ctx.accounts = {
      get incoming(): IncomingAccount {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return incomingAccount!
      },
      get outgoing(): OutgoingAccount {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return outgoingAccount!
      }
    }
    await next()
  }
}
