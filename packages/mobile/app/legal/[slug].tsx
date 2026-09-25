import { Linking, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { FontSize, Radius } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { useLegalDocument, useLegalIndex, type LegalSlug } from "@/queries/legal";
import { Body, Button, Card, ErrorState, Loading, ScreenHeader, TibebRule, Title } from "@/components/ui";

/**
 * The privacy policy, terms, about and contact pages, inside the app.
 *
 * Play requires the in-app policy to match the one at the listing URL, so both
 * are rendered from the same server documents rather than from a bundled copy
 * that would drift on the next policy change.
 *
 * Tables are rendered as stacked label/value rows, not as a grid — a
 * three-column policy table on a 360dp phone is unreadable, and this is the
 * screen most people will actually read the policy on.
 */

const SLUGS: LegalSlug[] = ["privacy", "terms", "about", "contact"];

function isSlug(value: unknown): value is LegalSlug {
  return typeof value === "string" && (SLUGS as string[]).includes(value);
}

function Table({ columns, rows }: { columns: string[]; rows: string[][] }) {
  const colors = useColors();
  return (
    <View style={{ gap: 10, marginTop: 12 }}>
      {rows.map((row, i) => (
        <View
          key={i}
          style={{
            gap: 6,
            padding: 14,
            borderRadius: Radius.card,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.card,
          }}
        >
          {row.map((cell, j) => (
            <View key={j} style={{ gap: 2 }}>
              <Body size={FontSize.caption} medium color={colors.mutedForeground}>
                {columns[j] ?? ""}
              </Body>
              <Body size={FontSize.small}>{cell}</Body>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function Section({
  section,
}: {
  section: {
    heading: string;
    body?: string[];
    bullets?: string[];
    table?: { columns: string[]; rows: string[][] };
  };
}) {
  const colors = useColors();
  return (
    <View style={{ gap: 8 }}>
      <Title size={FontSize.h3}>{section.heading}</Title>

      {section.body?.map((paragraph, i) => (
        <Body key={i} color={colors.mutedForeground} style={{ lineHeight: 22 }}>
          {paragraph}
        </Body>
      ))}

      {section.bullets?.map((bullet, i) => (
        <View key={i} style={{ flexDirection: "row", gap: 10 }}>
          <View
            style={{
              width: 5,
              height: 5,
              borderRadius: 3,
              marginTop: 8,
              backgroundColor: colors.primary,
            }}
          />
          <Body color={colors.mutedForeground} style={{ flex: 1, lineHeight: 22 }}>
            {bullet}
          </Body>
        </View>
      ))}

      {section.table ? <Table columns={section.table.columns} rows={section.table.rows} /> : null}
    </View>
  );
}

export default function LegalScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ slug?: string }>();
  const slug: LegalSlug = isSlug(params.slug) ? params.slug : "privacy";
  const doc = useLegalDocument(slug);
  const index = useLegalIndex();
  const operator = index.data?.operator;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <ScreenHeader
        title={doc.data?.title ?? "Loading"}
        subtitle={doc.data ? `Version ${doc.data.version} · Effective ${doc.data.effective}` : null}
        back
      />

      {doc.isLoading ? (
        <Loading label="Loading" />
      ) : doc.error || !doc.data ? (
        <ErrorState
          message="This document could not be loaded. Check your connection and try again."
          onRetry={() => doc.refetch()}
        />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 20, gap: 22, paddingBottom: 48 }}
          showsVerticalScrollIndicator={false}
        >
          <Body color={colors.mutedForeground} style={{ lineHeight: 22 }}>
            {doc.data.summary}
          </Body>

          <TibebRule width={160} />

          {doc.data.sections.map((section, i) => (
            <Section key={i} section={section} />
          ))}

          {operator ? (
            <Card style={{ gap: 8 }}>
              <Title size={FontSize.body}>Who publishes AmharicAI</Title>
              <Body size={FontSize.small} color={colors.mutedForeground}>
                {operator.trading_as} — {operator.public_name}
              </Body>
              <Button
                label={operator.support_email}
                variant="secondary"
                icon="mail-outline"
                onPress={() => {
                  void Linking.openURL(`mailto:${operator.support_email}`);
                }}
              />
            </Card>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
