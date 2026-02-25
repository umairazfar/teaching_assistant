import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
// The ?target=deno is critical here
import Stripe from "https://esm.sh/stripe@14.19.0?target=deno"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') as string, {
  httpClient: Stripe.createFetchHttpClient(), // Use Fetch instead of Node HTTP
  apiVersion: '2023-10-16',
});

// THIS IS THE FIX: Tell Stripe to use the Web Crypto API
const cryptoProvider = Stripe.createSubtleCryptoProvider();

serve(async (req) => {
  const signature = req.headers.get("stripe-signature");

  try {
    const body = await req.text(); // Read body as text for verification
    
    // We use constructEventAsync with the cryptoProvider
    const event = await stripe.webhooks.constructEventAsync(
      body,
      signature!,
      Deno.env.get('STRIPE_WEBHOOK_SECRET') as string,
      undefined,
      cryptoProvider // Pass the provider here
    );

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const userEmail = session.customer_details?.email;
      const amountPaid = session.amount_total; // in cents

      // Map payment to credits (e.g., 1000 cents = 100 credits)
      const creditsToAdd = 100; 

      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );

      const { error } = await supabase.rpc('add_user_credits', {
        user_email: userEmail,
        credit_amount: creditsToAdd
      });

      if (error) throw error;
      console.log(`Success: Added ${creditsToAdd} credits to ${userEmail}`);
    }

    return new Response(JSON.stringify({ received: true }), { status: 200 });
  } catch (err) {
    console.error(`Webhook Error: ${err.message}`);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }
})