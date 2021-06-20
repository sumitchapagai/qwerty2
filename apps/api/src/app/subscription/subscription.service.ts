import { ConfigurationService } from '@ghostfolio/api/services/configuration.service';
import { PrismaService } from '@ghostfolio/api/services/prisma.service';
import { Injectable } from '@nestjs/common';
import { addDays } from 'date-fns';
import Stripe from 'stripe';

@Injectable()
export class SubscriptionService {
  private stripe: Stripe;

  public constructor(
    private readonly configurationService: ConfigurationService,
    private prisma: PrismaService
  ) {
    this.stripe = new Stripe(
      this.configurationService.get('STRIPE_SECRET_KEY'),
      {
        apiVersion: '2020-08-27'
      }
    );
  }

  public async createCheckoutSession({
    priceId,
    userId
  }: {
    priceId: string;
    userId: string;
  }) {
    const session = await this.stripe.checkout.sessions.create({
      cancel_url: `${this.configurationService.get('ROOT_URL')}/account`,
      client_reference_id: userId,
      line_items: [
        {
          price: priceId,
          quantity: 1
        }
      ],
      metadata: {
        user_id: userId
      },
      mode: 'subscription',
      payment_method_types: ['card'],
      success_url: `${this.configurationService.get(
        'ROOT_URL'
      )}/api/subscription/stripe/callback?checkoutSessionId={CHECKOUT_SESSION_ID}`
    });

    return {
      sessionId: session.id
    };
  }

  public async createSubscription(aCheckoutSessionId: string) {
    try {
      const session = await this.stripe.checkout.sessions.retrieve(
        aCheckoutSessionId
      );

      await this.prisma.subscription.create({
        data: {
          expiresAt: addDays(new Date(), 365),
          User: {
            connect: {
              id: session.client_reference_id
            }
          }
        }
      });
    } catch (error) {
      console.error(error);
    }
  }
}
