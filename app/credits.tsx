import React, { useState, useEffect, useRef } from "react";
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
  Platform,
  ActivityIndicator,
  Linking,
  TextInput,
  Image,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import Colors from "@/constants/colors";

const C = Colors.light;

interface CreditPackage {
  id: string;
  name: string;
  price: number;
  currency: string;
  credits: number;
  description: string;
  creditsPerDay: number;
  days: number;
}

type ActiveTab = "buy" | "earn";

export default function CreditsScreen() {
  const insets = useSafeAreaInsets();
  const { user, isGuest, updateUser } = useAuth();
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>("buy");

  const [captchaImage, setCaptchaImage] = useState<string | null>(null);
  const [captchaId, setCaptchaId] = useState<string | null>(null);
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [captchaRemaining, setCaptchaRemaining] = useState(10);
  const [captchaMessage, setCaptchaMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  useEffect(() => {
    loadPackages();
    if (Platform.OS === "web") {
      const handler = (event: MessageEvent) => {
        if (event.data?.type === "PAYPAL_SUCCESS" && event.data?.credits) {
          handlePaymentSuccess(event.data.credits);
        }
        if (event.data?.type === "PAYPAL_CANCEL") {
          setPurchasing(null);
        }
      };
      window.addEventListener("message", handler);
      return () => window.removeEventListener("message", handler);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
    };
  }, []);

  function startCooldown(ms: number) {
    setCooldown(Math.ceil(ms / 1000));
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          if (cooldownRef.current) clearInterval(cooldownRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  async function loadPackages() {
    try {
      const res = await apiRequest("GET", "/api/paypal/packages");
      const data = await res.json();
      setPackages(data);
    } catch {
      setPackages([
        {
          id: "pkg_600",
          name: "Starter Pack",
          price: 10,
          currency: "GBP",
          credits: 600,
          description: "20 credits per day for 30 days",
          creditsPerDay: 20,
          days: 30,
        },
        {
          id: "pkg_1500",
          name: "Pro Pack",
          price: 20,
          currency: "GBP",
          credits: 1500,
          description: "50 credits per day for 30 days",
          creditsPerDay: 50,
          days: 30,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function handlePaymentSuccess(credits: number) {
    if (!user) return;
    const updatedUser = { ...user, credits: user.credits + credits };
    await updateUser(updatedUser);
    setPurchasing(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  async function handlePurchase(pkg: CreditPackage) {
    if (isGuest) {
      router.push("/auth");
      return;
    }
    setPurchasing(pkg.id);
    try {
      const res = await apiRequest("POST", "/api/paypal/create-order", {
        packageId: pkg.id,
      });
      const data = await res.json();

      if (data.approvalUrl) {
        if (Platform.OS === "web") {
          window.open(data.approvalUrl, "_blank", "width=500,height=700");
        } else {
          await Linking.openURL(data.approvalUrl);
        }
      }
    } catch (error: any) {
      setPurchasing(null);
    }
  }

  async function loadCaptcha() {
    if (isGuest) {
      router.push("/auth");
      return;
    }
    if (!user) return;
    setCaptchaLoading(true);
    setCaptchaMessage(null);
    setCaptchaAnswer("");
    try {
      const res = await apiRequest("POST", "/api/captcha/generate", { userId: user.id });
      const data = await res.json();
      if (data.error) {
        setCaptchaMessage({ text: data.error, type: "error" });
        if (data.cooldownMs) startCooldown(data.cooldownMs);
        setCaptchaImage(null);
        setCaptchaId(null);
      } else {
        setCaptchaImage(data.imageHtml);
        setCaptchaId(data.id);
        setCaptchaRemaining(data.remaining);
      }
    } catch (err: any) {
      const errData = err?.message ? { text: err.message, type: "error" as const } : { text: "Failed to load captcha", type: "error" as const };
      setCaptchaMessage(errData);
    } finally {
      setCaptchaLoading(false);
    }
  }

  async function submitCaptcha() {
    if (!user || !captchaId || !captchaAnswer.trim()) return;
    setCaptchaLoading(true);
    setCaptchaMessage(null);
    try {
      const res = await apiRequest("POST", "/api/captcha/verify", {
        userId: user.id,
        challengeId: captchaId,
        answer: captchaAnswer.trim(),
      });
      const data = await res.json();
      if (data.success) {
        const updatedUser = { ...user, credits: user.credits + 1 };
        await updateUser(updatedUser);
        setCaptchaRemaining(data.remaining);
        setCaptchaMessage({ text: "+1 credit earned!", type: "success" });
        setCaptchaImage(null);
        setCaptchaId(null);
        setCaptchaAnswer("");
        startCooldown(30000);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        setCaptchaMessage({ text: data.error || "Wrong answer", type: "error" });
        setCaptchaImage(null);
        setCaptchaId(null);
        setCaptchaAnswer("");
        if (data.cooldownMs) startCooldown(data.cooldownMs);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } catch (err: any) {
      let msg = "Verification failed";
      try {
        const parsed = JSON.parse(err?.message || "{}");
        if (parsed.error) msg = parsed.error;
      } catch {}
      setCaptchaMessage({ text: msg, type: "error" });
      setCaptchaImage(null);
      setCaptchaId(null);
      setCaptchaAnswer("");
    } finally {
      setCaptchaLoading(false);
    }
  }

  const currentCredits = user
    ? Math.max(0, user.freeTrialMessages - user.usedMessages + user.credits)
    : 0;

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: topInset + 16, paddingBottom: bottomInset + 100 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={C.text} />
        </Pressable>

        <View style={styles.balanceCard}>
          <LinearGradient
            colors={[C.card, C.cardElevated]}
            style={styles.balanceGradient}
          >
            <Text style={styles.balanceLabel}>Current Balance</Text>
            <Text style={styles.balanceValue}>{currentCredits}</Text>
            <Text style={styles.balanceUnit}>credits available</Text>
            {user && (
              <View style={styles.balanceBreakdown}>
                <View style={styles.breakdownItem}>
                  <Ionicons name="gift-outline" size={14} color={C.tint} />
                  <Text style={styles.breakdownText}>
                    Free: {Math.max(0, user.freeTrialMessages - user.usedMessages)}
                  </Text>
                </View>
                <View style={styles.breakdownDot} />
                <View style={styles.breakdownItem}>
                  <Ionicons name="diamond-outline" size={14} color={C.accent} />
                  <Text style={styles.breakdownText}>
                    Purchased: {user.credits}
                  </Text>
                </View>
              </View>
            )}
          </LinearGradient>
        </View>

        <View style={styles.tabRow}>
          <Pressable
            onPress={() => setActiveTab("buy")}
            style={[styles.tabBtn, activeTab === "buy" && styles.tabBtnActive]}
          >
            <Ionicons name="cart" size={18} color={activeTab === "buy" ? "#FFF" : C.textSecondary} />
            <Text style={[styles.tabText, activeTab === "buy" && styles.tabTextActive]}>Buy Credits</Text>
          </Pressable>
          <Pressable
            onPress={() => { setActiveTab("earn"); if (!captchaImage && !captchaMessage) loadCaptcha(); }}
            style={[styles.tabBtn, activeTab === "earn" && styles.tabBtnEarn]}
          >
            <Ionicons name="trophy" size={18} color={activeTab === "earn" ? "#FFF" : C.textSecondary} />
            <Text style={[styles.tabText, activeTab === "earn" && styles.tabTextActive]}>Earn Free</Text>
          </Pressable>
        </View>

        {activeTab === "buy" ? (
          <>
            <Text style={styles.sectionTitle}>Credit Packages</Text>
            <Text style={styles.sectionSubtitle}>
              Each credit equals one AI message. Choose the package that fits your needs.
            </Text>

            {loading ? (
              <ActivityIndicator size="large" color={C.tint} style={{ marginTop: 40 }} />
            ) : (
              <View style={styles.packagesContainer}>
                {packages.map((pkg, index) => {
                  const isPopular = index === 1;
                  return (
                    <View key={pkg.id} style={styles.packageWrapper}>
                      {isPopular && (
                        <LinearGradient
                          colors={[C.tint, C.accent]}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 0 }}
                          style={styles.popularBadge}
                        >
                          <Text style={styles.popularText}>BEST VALUE</Text>
                        </LinearGradient>
                      )}
                      <View
                        style={[
                          styles.packageCard,
                          isPopular && styles.packageCardPopular,
                        ]}
                      >
                        <View style={styles.packageHeader}>
                          <Text style={styles.packageName}>{pkg.name}</Text>
                          <View style={styles.priceRow}>
                            <Text style={styles.currencySymbol}>
                              {pkg.currency === "GBP" ? "\u00A3" : "$"}
                            </Text>
                            <Text style={styles.priceValue}>
                              {pkg.price.toFixed(0)}
                            </Text>
                          </View>
                        </View>

                        <View style={styles.packageDetails}>
                          <View style={styles.detailRow}>
                            <Ionicons
                              name="diamond"
                              size={16}
                              color={C.tint}
                            />
                            <Text style={styles.detailText}>
                              {pkg.credits} total credits
                            </Text>
                          </View>
                          <View style={styles.detailRow}>
                            <Ionicons
                              name="today"
                              size={16}
                              color={C.accent}
                            />
                            <Text style={styles.detailText}>
                              {pkg.creditsPerDay} credits/day
                            </Text>
                          </View>
                          <View style={styles.detailRow}>
                            <Ionicons
                              name="calendar"
                              size={16}
                              color={C.purple}
                            />
                            <Text style={styles.detailText}>
                              {pkg.days} day access
                            </Text>
                          </View>
                          <View style={styles.detailRow}>
                            <Ionicons
                              name="pricetag"
                              size={16}
                              color={C.success}
                            />
                            <Text style={styles.detailText}>
                              {pkg.currency === "GBP" ? "\u00A3" : "$"}
                              {(pkg.price / pkg.credits).toFixed(3)}/credit
                            </Text>
                          </View>
                        </View>

                        <Pressable
                          onPress={() => handlePurchase(pkg)}
                          disabled={purchasing === pkg.id}
                          style={({ pressed }) => [
                            styles.purchaseBtn,
                            isPopular && styles.purchaseBtnPopular,
                            { opacity: pressed ? 0.85 : 1 },
                          ]}
                        >
                          {purchasing === pkg.id ? (
                            <ActivityIndicator size="small" color="#FFF" />
                          ) : (
                            <>
                              <Ionicons name="logo-paypal" size={20} color="#FFF" />
                              <Text style={styles.purchaseBtnText}>
                                Pay with PayPal
                              </Text>
                            </>
                          )}
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

            <View style={styles.infoCard}>
              <Ionicons name="shield-checkmark" size={20} color={C.tint} />
              <Text style={styles.infoText}>
                Payments are processed securely through PayPal. Credits are added
                instantly to your account after successful payment.
              </Text>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.sectionTitle}>Earn Free Credits</Text>
            <Text style={styles.sectionSubtitle}>
              Solve captcha puzzles to earn 1 free credit each. Up to 10 per day!
            </Text>

            <View style={styles.earnCard}>
              <View style={styles.earnStatsRow}>
                <View style={styles.earnStat}>
                  <Text style={styles.earnStatValue}>{captchaRemaining}</Text>
                  <Text style={styles.earnStatLabel}>remaining today</Text>
                </View>
                <View style={styles.earnStatDivider} />
                <View style={styles.earnStat}>
                  <Text style={styles.earnStatValue}>1</Text>
                  <Text style={styles.earnStatLabel}>credit per solve</Text>
                </View>
                <View style={styles.earnStatDivider} />
                <View style={styles.earnStat}>
                  <Text style={styles.earnStatValue}>10</Text>
                  <Text style={styles.earnStatLabel}>daily max</Text>
                </View>
              </View>
            </View>

            {captchaMessage && (
              <View style={[styles.messageCard, captchaMessage.type === "success" ? styles.messageSuccess : styles.messageError]}>
                <Ionicons
                  name={captchaMessage.type === "success" ? "checkmark-circle" : "alert-circle"}
                  size={20}
                  color={captchaMessage.type === "success" ? C.success : C.danger}
                />
                <Text style={[styles.messageText, { color: captchaMessage.type === "success" ? C.success : C.danger }]}>
                  {captchaMessage.text}
                </Text>
              </View>
            )}

            <View style={styles.captchaContainer}>
              {captchaLoading ? (
                <View style={styles.captchaPlaceholder}>
                  <ActivityIndicator size="large" color={C.tint} />
                  <Text style={styles.captchaLoadingText}>Loading puzzle...</Text>
                </View>
              ) : captchaImage ? (
                <>
                  <View style={styles.captchaImageWrap}>
                    <Image
                      source={{ uri: captchaImage }}
                      style={styles.captchaImage}
                      resizeMode="contain"
                    />
                    <Pressable onPress={loadCaptcha} style={styles.refreshBtn} testID="captcha-refresh">
                      <Ionicons name="refresh" size={20} color={C.tint} />
                    </Pressable>
                  </View>

                  <View style={styles.answerRow}>
                    <TextInput
                      style={styles.answerInput}
                      placeholder="Your answer"
                      placeholderTextColor={C.placeholder}
                      value={captchaAnswer}
                      onChangeText={setCaptchaAnswer}
                      keyboardType="number-pad"
                      returnKeyType="done"
                      onSubmitEditing={submitCaptcha}
                      testID="captcha-answer"
                    />
                    <Pressable
                      onPress={submitCaptcha}
                      disabled={!captchaAnswer.trim() || captchaLoading}
                      style={({ pressed }) => [
                        styles.submitBtn,
                        { opacity: !captchaAnswer.trim() ? 0.5 : pressed ? 0.85 : 1 },
                      ]}
                      testID="captcha-submit"
                    >
                      <Ionicons name="checkmark" size={22} color="#FFF" />
                    </Pressable>
                  </View>
                </>
              ) : (
                <Pressable
                  onPress={loadCaptcha}
                  disabled={cooldown > 0}
                  style={({ pressed }) => [
                    styles.loadCaptchaBtn,
                    { opacity: cooldown > 0 ? 0.5 : pressed ? 0.85 : 1 },
                  ]}
                  testID="captcha-start"
                >
                  <LinearGradient
                    colors={cooldown > 0 ? [C.card, C.card] : [C.tint, C.accent]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.loadCaptchaBtnInner}
                  >
                    <Ionicons name={cooldown > 0 ? "time" : "flash"} size={24} color="#FFF" />
                    <Text style={styles.loadCaptchaBtnText}>
                      {cooldown > 0 ? `Wait ${cooldown}s...` : "Solve a Captcha"}
                    </Text>
                  </LinearGradient>
                </Pressable>
              )}
            </View>

            <View style={styles.earnInfoCard}>
              <Text style={styles.earnInfoTitle}>How it works</Text>
              <View style={styles.earnInfoStep}>
                <View style={styles.stepDot}><Text style={styles.stepDotText}>1</Text></View>
                <Text style={styles.earnInfoText}>Tap "Solve a Captcha" to get a math puzzle</Text>
              </View>
              <View style={styles.earnInfoStep}>
                <View style={styles.stepDot}><Text style={styles.stepDotText}>2</Text></View>
                <Text style={styles.earnInfoText}>Type the correct answer and submit</Text>
              </View>
              <View style={styles.earnInfoStep}>
                <View style={styles.stepDot}><Text style={styles.stepDotText}>3</Text></View>
                <Text style={styles.earnInfoText}>Earn 1 credit instantly - up to 10 per day</Text>
              </View>
            </View>

            <View style={styles.adCard}>
              <View style={styles.adCardHeader}>
                <View style={styles.adCardIconWrap}>
                  <Ionicons name="cash-outline" size={22} color="#10B981" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.adCardTitle}>AdCash</Text>
                  <Text style={styles.adCardSub}>Watch ads to support the platform</Text>
                </View>
              </View>
              {Platform.OS === "web" && (
                <View style={styles.adCardWebNote}>
                  <Ionicons name="information-circle-outline" size={16} color={C.textTertiary} />
                  <Text style={styles.adCardWebNoteText}>Ad content loads on web</Text>
                </View>
              )}
            </View>

            <View style={styles.adCard}>
              <View style={styles.adCardHeader}>
                <View style={[styles.adCardIconWrap, { backgroundColor: "#8B5CF6" + "20" }]}>
                  <Ionicons name="videocam-outline" size={22} color="#8B5CF6" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.adCardTitle}>Applixir</Text>
                  <Text style={styles.adCardSub}>Watch rewarded video ads to earn credits</Text>
                </View>
              </View>
              <Pressable
                onPress={() => {
                  if (Platform.OS === "web") {
                    try {
                      (window as any).invokeApplixirVideoUnit?.({ zoneId: 4508 });
                    } catch {}
                  }
                }}
                style={({ pressed }) => [styles.adWatchBtn, { opacity: pressed ? 0.85 : 1 }]}
              >
                <Ionicons name="play-circle" size={20} color="#FFF" />
                <Text style={styles.adWatchBtnText}>Watch Video</Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  scrollContent: { paddingHorizontal: 20 },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  balanceCard: {
    borderRadius: 20,
    overflow: "hidden",
    marginBottom: 24,
  },
  balanceGradient: {
    padding: 28,
    alignItems: "center",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.borderLight,
  },
  balanceLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    color: C.textSecondary,
    marginBottom: 8,
  },
  balanceValue: {
    fontFamily: "Inter_700Bold",
    fontSize: 56,
    color: C.text,
    lineHeight: 64,
  },
  balanceUnit: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: C.textTertiary,
    marginTop: 4,
  },
  balanceBreakdown: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  breakdownItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  breakdownDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.textTertiary,
  },
  breakdownText: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: C.textSecondary,
  },
  tabRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 24,
  },
  tabBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
  },
  tabBtnActive: {
    backgroundColor: C.accent,
    borderColor: C.accent,
  },
  tabBtnEarn: {
    backgroundColor: C.success,
    borderColor: C.success,
  },
  tabText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    color: C.textSecondary,
  },
  tabTextActive: {
    color: "#FFF",
  },
  sectionTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 20,
    color: C.text,
    marginBottom: 6,
  },
  sectionSubtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: C.textSecondary,
    marginBottom: 24,
    lineHeight: 20,
  },
  packagesContainer: {
    gap: 20,
    marginBottom: 28,
  },
  packageWrapper: {
    position: "relative" as const,
  },
  popularBadge: {
    position: "absolute" as const,
    top: -12,
    right: 20,
    zIndex: 1,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
  },
  popularText: {
    fontFamily: "Inter_700Bold",
    fontSize: 11,
    color: "#FFF",
    letterSpacing: 1,
  },
  packageCard: {
    backgroundColor: C.card,
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: C.border,
  },
  packageCardPopular: {
    borderColor: C.tint + "60",
    borderWidth: 2,
  },
  packageHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  packageName: {
    fontFamily: "Inter_700Bold",
    fontSize: 18,
    color: C.text,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  currencySymbol: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 18,
    color: C.tint,
    marginTop: 4,
  },
  priceValue: {
    fontFamily: "Inter_700Bold",
    fontSize: 36,
    color: C.tint,
    lineHeight: 42,
  },
  packageDetails: {
    gap: 12,
    marginBottom: 24,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  detailText: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: C.textSecondary,
  },
  purchaseBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#0070BA",
    paddingVertical: 16,
    borderRadius: 14,
  },
  purchaseBtnPopular: {
    backgroundColor: C.tint,
  },
  purchaseBtnText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
    color: "#FFF",
  },
  infoCard: {
    flexDirection: "row",
    gap: 12,
    backgroundColor: C.tint + "10",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: C.tint + "20",
  },
  infoText: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: C.textSecondary,
    lineHeight: 18,
  },
  earnCard: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: C.borderLight,
  },
  earnStatsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
  },
  earnStat: {
    alignItems: "center",
  },
  earnStatValue: {
    fontFamily: "Inter_700Bold",
    fontSize: 24,
    color: C.success,
  },
  earnStatLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: C.textTertiary,
    marginTop: 4,
  },
  earnStatDivider: {
    width: 1,
    height: 32,
    backgroundColor: C.borderLight,
  },
  messageCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderRadius: 12,
    marginBottom: 16,
  },
  messageSuccess: {
    backgroundColor: C.success + "15",
    borderWidth: 1,
    borderColor: C.success + "30",
  },
  messageError: {
    backgroundColor: C.danger + "15",
    borderWidth: 1,
    borderColor: C.danger + "30",
  },
  messageText: {
    flex: 1,
    fontFamily: "Inter_500Medium",
    fontSize: 14,
  },
  captchaContainer: {
    marginBottom: 24,
  },
  captchaPlaceholder: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 40,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: C.borderLight,
  },
  captchaLoadingText: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: C.textSecondary,
    marginTop: 12,
  },
  captchaImageWrap: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    borderWidth: 1,
    borderColor: C.borderLight,
    marginBottom: 14,
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
  },
  captchaImage: {
    width: 280,
    height: 80,
    borderRadius: 8,
  },
  refreshBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  answerRow: {
    flexDirection: "row",
    gap: 12,
  },
  answerInput: {
    flex: 1,
    backgroundColor: C.inputBackground,
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 14,
    fontFamily: "Inter_500Medium",
    fontSize: 18,
    color: C.text,
    borderWidth: 1,
    borderColor: C.inputBorder,
    textAlign: "center",
    letterSpacing: 2,
  },
  submitBtn: {
    width: 54,
    height: 54,
    borderRadius: 14,
    backgroundColor: C.success,
    alignItems: "center",
    justifyContent: "center",
  },
  loadCaptchaBtn: {
    borderRadius: 16,
    overflow: "hidden",
  },
  loadCaptchaBtnInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingVertical: 20,
    borderRadius: 16,
  },
  loadCaptchaBtnText: {
    fontFamily: "Inter_700Bold",
    fontSize: 18,
    color: "#FFF",
  },
  earnInfoCard: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: C.borderLight,
  },
  earnInfoTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
    color: C.text,
    marginBottom: 16,
  },
  earnInfoStep: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginBottom: 14,
  },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: C.tint + "20",
    alignItems: "center",
    justifyContent: "center",
  },
  stepDotText: {
    fontFamily: "Inter_700Bold",
    fontSize: 13,
    color: C.tint,
  },
  earnInfoText: {
    flex: 1,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: C.textSecondary,
    lineHeight: 20,
  },
  adCard: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 20,
    marginTop: 16,
    borderWidth: 1,
    borderColor: C.borderLight,
  },
  adCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  adCardIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#10B981" + "20",
    alignItems: "center",
    justifyContent: "center",
  },
  adCardTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
    color: C.text,
  },
  adCardSub: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: C.textSecondary,
    marginTop: 2,
  },
  adCardWebNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.borderLight,
  },
  adCardWebNoteText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: C.textTertiary,
  },
  adWatchBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#8B5CF6",
    borderRadius: 12,
    paddingVertical: 12,
    marginTop: 14,
  },
  adWatchBtnText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: "#FFF",
  },
});
