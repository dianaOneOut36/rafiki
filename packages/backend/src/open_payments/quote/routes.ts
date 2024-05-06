import { AccessAction } from '@interledger/open-payments'
import { Logger } from 'pino'
import { ReadContext, CreateContext } from '../../app'
import { IAppConfig } from '../../config/app'
import { CreateQuoteOptions, QuoteService } from './service'
import { isQuoteError, errorToCode, errorToMessage } from './errors'
import { Quote } from './model'
import { AmountJSON, parseAmount } from '../amount'
import { Quote as OpenPaymentsQuote } from '@interledger/open-payments'
import {
  WalletAddress,
  throwIfMissingWalletAddress
} from '../wallet_address/model'
import { OpenPaymentsServerRouteError } from '../route-errors'
import { WalletAddressService } from '../wallet_address/service'

interface ServiceDependencies {
  config: IAppConfig
  logger: Logger
  quoteService: QuoteService
  walletAddressService: WalletAddressService
}

export interface QuoteRoutes {
  get(ctx: ReadContext): Promise<void>
  create(ctx: CreateContext<CreateBody>): Promise<void>
}

export function createQuoteRoutes(deps_: ServiceDependencies): QuoteRoutes {
  const logger = deps_.logger.child({
    service: 'QuoteRoutes'
  })
  const deps = { ...deps_, logger }
  return {
    get: (ctx: ReadContext) => getQuote(deps, ctx),
    create: (ctx: CreateContext<CreateBody>) => createQuote(deps, ctx)
  }
}

async function getQuote(
  deps: ServiceDependencies,
  ctx: ReadContext
): Promise<void> {
  const quote = await deps.quoteService.get({
    id: ctx.params.id,
    client: ctx.accessAction === AccessAction.Read ? ctx.client : undefined
  })

  if (!quote) {
    throw new OpenPaymentsServerRouteError(404, 'Quote does not exist', {
      id: ctx.params.id
    })
  }

  throwIfMissingWalletAddress(deps, quote)

  ctx.body = quoteToBody(quote.walletAddress, quote)
}

interface CreateBodyBase {
  walletAddress: string
  receiver: string
  method: 'ilp'
}

interface CreateBodyWithDebitAmount extends CreateBodyBase {
  debitAmount?: AmountJSON
  receiveAmount?: never
}

interface CreateBodyWithReceiveAmount extends CreateBodyBase {
  debitAmount?: never
  receiveAmount?: AmountJSON
}

export type CreateBody = CreateBodyWithDebitAmount | CreateBodyWithReceiveAmount

async function createQuote(
  deps: ServiceDependencies,
  ctx: CreateContext<CreateBody>
): Promise<void> {
  const { body } = ctx.request

  const walletAddress = await deps.walletAddressService.getOrPollByUrl(
    ctx.walletAddressUrl
  )

  if (!walletAddress) {
    throw new OpenPaymentsServerRouteError(400, 'Could not get wallet address')
  }

  const options: CreateQuoteOptions = {
    walletAddressId: walletAddress.id,
    receiver: body.receiver,
    client: ctx.client,
    method: body.method
  }

  try {
    if (body.debitAmount) options.debitAmount = parseAmount(body.debitAmount)
    if (body.receiveAmount)
      options.receiveAmount = parseAmount(body.receiveAmount)
  } catch (err) {
    throw new OpenPaymentsServerRouteError(
      400,
      'Could not parse amounts when creating quote',
      { requestBody: body }
    )
  }

  const quoteOrErr = await deps.quoteService.create(options)

  if (isQuoteError(quoteOrErr)) {
    throw new OpenPaymentsServerRouteError(
      errorToCode[quoteOrErr],
      errorToMessage[quoteOrErr]
    )
  }

  ctx.status = 201
  ctx.body = quoteToBody(walletAddress, quoteOrErr)
}

function quoteToBody(
  walletAddress: WalletAddress,
  quote: Quote
): OpenPaymentsQuote {
  return quote.toOpenPaymentsType(walletAddress)
}
