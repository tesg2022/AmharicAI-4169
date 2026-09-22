import { useState } from "react";
import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { FontSize, Radius } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { useBuyPlan } from "@/hooks/use-buy-plan";
import { useCatalogue } from "@/queries/billing";
import { usePaypalCatalogue } from "@/queries/billing-paypal";
import { failureMessage } from "@/queries/catalog";
import { Am, Body, Button, Card, Chip, ErrorState, Loading, Title } from "@/components/ui";

/**
 * The paid plans, as one block, used by both Pricing and Your plan.
 *
 * It is a single component on purpose. The two screens previously each carried
 * their own copy of the list, one quoting a dollar-a-month figure for every plan — which
 * is not a thing Lifetime has — and both of them offering a checkout that
 * could not charge. Two copies of a price list is two chances to be wrong.
 *
 * What it will not do:
 *
 *   - quote a price it made up. Every figure here comes from
 *     `billing.catalogue`, the same call the website renders from.
 *   - claim a purchase happened. Only the server says what is held; a returned
 *     checkout triggers a re-read, never a local grant.
 *   - hide the upgrade somebody came for. "You are on Premium" and "you are
 *     paying for Premium monthly" are different facts, so an annual or
 *     lifetime option stays live for a monthly subscriber instead of being
 *     greyed out as "your current plan".
 */

function termSuffix(term: string | null | undefined): string {
  return term === "monthly" ? "/month" : term === "annual" ? "/year" : term === "lifetime" ? " once" : "";
}

export function PaidPlans() {
  const colors = useColors();
  const catalogue = useCatalogue();
  // Loaded alongside the rand catalogue, never instead of it. If PayPal is
  // unconfigured or this call fails, the card path still sells — the screen
  // simply draws no PayPal button, which is the honest failure.
  const paypalCatalogue = usePaypalCatalogue();
  const { buy, buying, buyWithPaypal, buyingPaypal, error, stopped } = useBuyPlan();

  /** Which billing term is selected per plan — Premium is sold three ways. */
  const [chosen, setChosen] = useState<Record<string, string>>({});

  if (catalogue.isLoading) return <Loading label="Loading prices…" />;
  if (catalogue.isError || !catalogue.data) {
    return (
      <ErrorState
        message={failureMessage(catalogue.error) ?? "The price list could not be loaded."}
        onRetry={() => catalogue.refetch()}
      />
    );
  }

  const data = catalogue.data;

  return (
    <View style={{ gap: 14 }}>
      {/* Checkout being off is stated before anyone taps, never after. */}
      {!data.checkout_available ? (
        <View
          style={{
            backgroundColor: colors.accent + "22",
            borderLeftWidth: 3,
            borderLeftColor: colors.warning,
            borderRadius: 10,
            padding: 12,
            gap: 4,
          }}
        >
          <Body size={FontSize.small} bold color={colors.warning}>
            Checkout is not open yet
          </Body>
          <Body size={FontSize.caption} color={colors.foreground}>
            The prices below are the real ones, but this build cannot take a payment. Nothing is
            charged either way.
          </Body>
          {data.billing_status.blockers.map((b, i) => (
            <Body key={`blk-${i}`} size={FontSize.caption} color={colors.mutedForeground}>
              • {b}
            </Body>
          ))}
        </View>
      ) : null}

      {data.plans.map((p) => {
        const options = p.billing_options;
        // Open on the term they are actually paying for, not on whichever is
        // listed first: an annual subscriber shown a card preselected on
        // "monthly" is being shown somebody else's plan.
        const heldHere = options.find((o) => data.held_option_ids.includes(o.id));
        const selectedId = chosen[p.id] ?? heldHere?.id ?? options[0]?.id ?? null;
        const selected = options.find((o) => o.id === selectedId) ?? options[0];
        const isCurrentTier = p.id === data.current_plan;
        const holdsThisOption = Boolean(selected && data.held_option_ids.includes(selected.id));
        // The PayPal view of the same option id — both catalogues are built
        // from one option list, so the ids line up. Absent for lifetime (no
        // USD price) and whenever PayPal cannot sell, and then no PayPal
        // button is drawn rather than one that fails when tapped.
        const selectedPaypal = selected
          ? paypalCatalogue.data?.options.find((o) => o.id === selected.id)
          : undefined;
        const paypalSellable = Boolean(selectedPaypal?.sellable && selectedPaypal.price_label);

        return (
          <Card
            key={p.id}
            style={{
              gap: 10,
              borderColor: isCurrentTier ? colors.primary : colors.border,
              borderWidth: isCurrentTier ? 2 : 1,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Title size={FontSize.h3}>{p.name_en}</Title>
                <Am size={FontSize.small} color={colors.primary}>
                  {p.name_am}
                </Am>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Title size={FontSize.h2}>
                  {options.length === 0 ? "Free" : (selected?.price_label ?? "—")}
                </Title>
                {selected ? (
                  <>
                    <Body size={FontSize.caption} color={colors.mutedForeground}>
                      {termSuffix(selected.term)}
                    </Body>
                    {/* The rand figure above is what Paystack charges. The
                        dollar one is a conversion at a rate nobody here
                        controls, so it is labelled as approximate by the
                        server and shown as secondary — never as the price. */}
                    <Body size={FontSize.caption} color={colors.mutedForeground}>
                      {selected.price_approx_usd_label}
                    </Body>
                    <Body size={FontSize.caption} color={colors.mutedForeground}>
                      {selected.billed_in_note}
                    </Body>
                  </>
                ) : null}
              </View>
            </View>

            <Body size={FontSize.small} color={colors.mutedForeground}>
              {p.tagline_en}
            </Body>

            <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
              <Chip
                label={p.max_units === null ? "Every written unit" : `Units 1-${p.max_units} only`}
                icon="book-outline"
              />
              <Chip
                label={
                  p.quotas.tts_per_day === null
                    ? "Unmetered listening"
                    : `${p.quotas.tts_per_day} listens/day`
                }
                icon="volume-medium-outline"
              />
              <Chip label={p.tutor_allowance_label} icon="chatbubbles-outline" />
            </View>

            {/* Premium is one tier sold three ways. The terms are a choice
                inside its card, never three separate tiers. */}
            {options.length > 1 ? (
              <View
                style={{ gap: 6 }}
                accessibilityRole="radiogroup"
                accessibilityLabel={`Billing term for ${p.name_en}`}
              >
                {options.map((o) => {
                  const active = o.id === selectedId;
                  return (
                    <Pressable
                      key={o.id}
                      onPress={() => setChosen((prev) => ({ ...prev, [p.id]: o.id }))}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: active }}
                      // react-native-web does not map accessibilityState.checked
                      // onto aria-checked, so on web every term announced as
                      // unchecked. Passing aria-checked directly is what a
                      // screen reader actually reads; native uses the former.
                      aria-checked={active}
                      accessibilityLabel={`${o.label_en}${o.note_en ? `. ${o.note_en}` : ""}`}
                      style={{
                        flexDirection: "row",
                        alignItems: "flex-start",
                        gap: 8,
                        padding: 10,
                        borderRadius: Radius.card,
                        borderWidth: 1,
                        borderColor: active ? colors.primary : colors.border,
                        backgroundColor: active ? colors.primary + "14" : "transparent",
                      }}
                    >
                      <Ionicons
                        name={active ? "radio-button-on" : "radio-button-off"}
                        size={17}
                        color={active ? colors.primary : colors.mutedForeground}
                        style={{ marginTop: 1 }}
                      />
                      <View style={{ flex: 1, gap: 2 }}>
                        <Body size={FontSize.small} medium>
                          {o.label_en}
                        </Body>
                        {o.note_en ? (
                          <Body size={FontSize.caption} color={colors.mutedForeground}>
                            {o.note_en}
                          </Body>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            {holdsThisOption || (isCurrentTier && data.plan_source !== "subscription") ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderRadius: Radius.pill,
                  backgroundColor: colors.primary + "1A",
                }}
              >
                <Ionicons name="checkmark-circle" size={15} color={colors.primary} />
                <Body size={FontSize.small} medium color={colors.primary}>
                  Your current plan
                </Body>
              </View>
            ) : options.length === 0 ? (
              <View
                style={{
                  alignItems: "center",
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderRadius: Radius.pill,
                  backgroundColor: colors.muted,
                }}
              >
                <Body size={FontSize.small} medium color={colors.mutedForeground}>
                  Free, always
                </Body>
              </View>
            ) : (
              /* Two ways to pay the same thing, side by side, because which
                 one works depends on where the learner banks: a card in rand
                 through Paystack, or PayPal in dollars. Nothing here guesses
                 at their country — both are offered and they choose. */
              <View style={{ gap: 8 }}>
                <Button
                  label={
                    !data.checkout_available
                      ? "Checkout unavailable"
                      : isCurrentTier
                        ? // Same tier, different term: a change of how they pay,
                          // not a new plan. "Get Premium" to a Premium
                          // subscriber reads as a mistake.
                          selected?.term === "lifetime"
                          ? `Buy ${p.name_en} for life — ${selected?.price_label}`
                          : `Switch to ${selected?.term ?? ""} — ${selected?.price_label}`
                        : `Get ${p.name_en} — ${selected?.price_label}`
                  }
                  icon="card-outline"
                  full
                  loading={buying === selected?.id}
                  disabled={
                    !selected || buying !== null || buyingPaypal !== null || !data.checkout_available
                  }
                  onPress={() => selected && void buy(selected.id)}
                />
                {paypalSellable ? (
                  <>
                    <Button
                      label={
                        buyingPaypal === selected?.id
                          ? "Opening PayPal…"
                          : `Pay with PayPal — ${selectedPaypal!.price_label}`
                      }
                      icon="logo-paypal"
                      variant="secondary"
                      full
                      loading={buyingPaypal === selected?.id}
                      disabled={!selected || buying !== null || buyingPaypal !== null}
                      onPress={() => selected && void buyWithPaypal(selected.id)}
                    />
                    {/* The dollar figure on that button is charged, not
                        converted — so it is said once, plainly, instead of
                        leaving somebody to wonder which number applies. */}
                    <Body
                      size={FontSize.caption}
                      color={colors.mutedForeground}
                      style={{ textAlign: "center" }}
                    >
                      Billed in US dollars by PayPal
                    </Body>
                  </>
                ) : null}
              </View>
            )}
          </Card>
        );
      })}

      {/* This used to read "Prices are in US dollars", which was wrong about
          the card path and is now wrong about only half of a screen that has
          two currencies on it. Both are stated, each attached to the way of
          paying that actually charges it. */}
      <Body size={FontSize.caption} color={colors.mutedForeground}>
        Card payments are charged in South African rand (ZAR) — that is the price shown on each
        card. Paying with PayPal is charged in US dollars at the dollar price on its own button,
        which is an amount charged rather than a conversion. Monthly and annual subscriptions
        renew until you cancel; Lifetime is a single payment, sold by card only. Annual and
        Lifetime are billing terms for Premium — they unlock exactly what monthly Premium does,
        no more.
      </Body>

      {stopped.length > 0 ? (
        <View
          style={{
            borderLeftWidth: 3,
            borderLeftColor: colors.primary,
            backgroundColor: colors.primary + "0F",
            borderRadius: 10,
            padding: 12,
            gap: 4,
          }}
        >
          <Body size={FontSize.small} bold color={colors.primary}>
            {stopped.length === 1
              ? `Your ${stopped[0]} subscription has been cancelled.`
              : `Subscriptions you have outgrown have been cancelled: ${stopped.join(", ")}.`}
          </Body>
          <Body size={FontSize.caption} color={colors.mutedForeground}>
            You keep it until the end of the period you have already paid for, and it will not
            renew. Your plan itself is unaffected.
          </Body>
        </View>
      ) : null}

      {error ? (
        <Card style={{ gap: 6, borderColor: colors.warning }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Ionicons name="alert-circle-outline" size={18} color={colors.warning} />
            <Body size={FontSize.small} bold color={colors.warning}>
              Nothing was charged
            </Body>
          </View>
          <Body size={FontSize.small}>{error.message}</Body>
          {error.blockers.map((b, i) => (
            <Body key={`e-${i}`} size={FontSize.caption} color={colors.mutedForeground}>
              • {b}
            </Body>
          ))}
        </Card>
      ) : null}
    </View>
  );
}
