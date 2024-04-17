import {
  ResolversTypes,
  WalletAddressResolvers,
  MutationResolvers,
  IncomingPayment as SchemaIncomingPayment,
  QueryResolvers
} from '../generated/graphql'
import { IncomingPayment } from '../../open_payments/payment/incoming/model'
import {
  isIncomingPaymentError,
  errorToCode,
  errorToMessage
} from '../../open_payments/payment/incoming/errors'
import { ApolloContext } from '../../app'
import { getPageInfo } from '../../shared/pagination'
import { Pagination, SortOrder } from '../../shared/baseModel'
import { GraphQLError } from 'graphql'

export const getIncomingPayment: QueryResolvers<ApolloContext>['incomingPayment'] =
  async (parent, args, ctx): Promise<ResolversTypes['IncomingPayment']> => {
    const incomingPaymentService = await ctx.container.use(
      'incomingPaymentService'
    )
    const payment = await incomingPaymentService.get({
      id: args.id
    })
    if (!payment) throw new Error('payment does not exist')
    return paymentToGraphql(payment)
  }

export const getWalletAddressIncomingPayments: WalletAddressResolvers<ApolloContext>['incomingPayments'] =
  async (
    parent,
    args,
    ctx
  ): Promise<ResolversTypes['IncomingPaymentConnection']> => {
    if (!parent.id) throw new Error('missing wallet address id')
    const incomingPaymentService = await ctx.container.use(
      'incomingPaymentService'
    )
    const { sortOrder, ...pagination } = args
    const order = sortOrder === 'ASC' ? SortOrder.Asc : SortOrder.Desc
    const incomingPayments = await incomingPaymentService.getWalletAddressPage({
      walletAddressId: parent.id,
      pagination,
      sortOrder: order
    })
    const pageInfo = await getPageInfo({
      getPage: (pagination: Pagination, sortOrder?: SortOrder) =>
        incomingPaymentService.getWalletAddressPage({
          walletAddressId: parent.id as string,
          pagination,
          sortOrder
        }),
      page: incomingPayments,
      sortOrder: order
    })

    return {
      pageInfo,
      edges: incomingPayments.map((incomingPayment: IncomingPayment) => {
        return {
          cursor: incomingPayment.id,
          node: paymentToGraphql(incomingPayment)
        }
      })
    }
  }
export const createIncomingPayment: MutationResolvers<ApolloContext>['createIncomingPayment'] =
  async (
    parent,
    args,
    ctx
  ): Promise<ResolversTypes['IncomingPaymentResponse']> => {
    const incomingPaymentService = await ctx.container.use(
      'incomingPaymentService'
    )
    const incomingPaymentOrError = await incomingPaymentService.create({
      walletAddressId: args.input.walletAddressId,
      expiresAt: !args.input.expiresAt
        ? undefined
        : new Date(args.input.expiresAt),
      incomingAmount: args.input.incomingAmount,
      metadata: args.input.metadata
    })
    if (isIncomingPaymentError(incomingPaymentOrError)) {
      throw new GraphQLError(errorToMessage[incomingPaymentOrError], {
        extensions: {
          code: errorToCode[incomingPaymentOrError]
        }
      })
    } else
      return {
        payment: paymentToGraphql(incomingPaymentOrError)
      }
  }

export function paymentToGraphql(
  payment: IncomingPayment
): SchemaIncomingPayment {
  return {
    id: payment.id,
    walletAddressId: payment.walletAddressId,
    state: payment.state,
    expiresAt: payment.expiresAt.toISOString(),
    incomingAmount: payment.incomingAmount,
    receivedAmount: payment.receivedAmount,
    metadata: payment.metadata,
    createdAt: new Date(+payment.createdAt).toISOString()
  }
}
