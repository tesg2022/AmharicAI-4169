import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";

/**
 * Opening a Paystack checkout page from the app.
 *
 * The two platforms cannot behave the same way here, and pretending they can
 * is how a purchase gets lost:
 *
 *   - On web (Expo web, and the desktop shell that loads it) the tab is
 *     navigated away, exactly as the website does. The app is torn down; the
 *     return leg is a fresh page load, so nothing can be done after this call
 *     and the caller must not try.
 *   - On a phone the payment page opens in an in-app browser and the app stays
 *     alive behind it. When that browser closes — paid, abandoned, or the
 *     back gesture — control returns here, and the caller re-reads the plan
 *     from the server instead of guessing what happened.
 *
 * A dismissal is deliberately NOT treated as a cancellation: Paystack's
 * confirmation page is a web page with no way back into a native app, so a
 * learner who has genuinely paid also leaves by closing the browser. Only the
 * server knows, which is why "returned" means "go ask it" — specifically
 * `billing.verify` with the reference — and not "nothing happened".
 */
export type CheckoutReturn = "left" | "returned";

export async function openCheckout(url: string): Promise<CheckoutReturn> {
  if (Platform.OS === "web") {
    window.location.assign(url);
    return "left";
  }

  await WebBrowser.openBrowserAsync(url, {
    // Dismiss reads as "I am done with this page", which is what it is —
    // the purchase itself is confirmed by the server, not by this button.
    dismissButtonStyle: "done",
    enableBarCollapsing: true,
  });
  return "returned";
}
