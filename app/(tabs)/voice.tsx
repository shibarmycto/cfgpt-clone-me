import React, { useState, useCallback, useRef } from "react";
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
  Platform,
  Alert,
  ActivityIndicator,
  TextInput,
  Linking,
  Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";
import * as DocumentPicker from "expo-document-picker";
import { useAuth } from "@/contexts/AuthContext";
import {
  VoiceRequest,
  saveVoiceRequest,
  getVoiceRequests,
  generateId,
  ensureUserFields,
} from "@/lib/storage-helpers";
import { apiRequest } from "@/lib/query-client";
import Colors from "@/constants/colors";
import { LinearGradient } from "expo-linear-gradient";

const C = Colors.light;

type VoiceTab = "credits" | "numbers" | "create";

interface AvailableNumber {
  phoneNumber: string;
  locality: string;
  region: string;
  monthlyRate: string;
  currency: string;
}

export default function VoiceAssistantScreen() {
  const insets = useSafeAreaInsets();
  const { user, isGuest, updateUser } = useAuth();
  const [activeTab, setActiveTab] = useState<VoiceTab>("credits");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const [availableNumbers, setAvailableNumbers] = useState<AvailableNumber[]>([]);
  const [numbersLoading, setNumbersLoading] = useState(false);
  const [purchasingNumber, setPurchasingNumber] = useState<string | null>(null);

  const [voiceFile, setVoiceFile] = useState<{ uri: string; name: string } | null>(null);
  const [agentPrompt, setAgentPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [myRequests, setMyRequests] = useState<VoiceRequest[]>([]);

  const safeUser = user ? ensureUserFields(user) : null;
  const voiceCredits = safeUser?.voiceCredits ?? 0;
  const hasPaid = safeUser?.hasPaidViaPaypal ?? false;

  const loadMyRequests = useCallback(async () => {
    if (!user) return;
    const all = await getVoiceRequests();
    setMyRequests(all.filter(r => r.userId === user.id));
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      loadMyRequests();
    }, [loadMyRequests])
  );

  const fetchAvailableNumbers = async () => {
    if (!hasPaid) {
      setMessage({ text: "Purchase Voice Credits first to browse numbers", type: "error" });
      return;
    }
    setNumbersLoading(true);
    try {
      const res = await apiRequest("GET", "/api/telnyx/available-numbers");
      const data = await res.json();
      setAvailableNumbers(data);
    } catch {
      setMessage({ text: "Could not load numbers. Try again.", type: "error" });
    } finally {
      setNumbersLoading(false);
    }
  };

  const purchaseNumber = async (phoneNumber: string) => {
    if (!user || !safeUser) return;
    if (voiceCredits < 5) {
      setMessage({ text: "You need at least 5 Voice Credits", type: "error" });
      return;
    }
    setPurchasingNumber(phoneNumber);
    try {
      await apiRequest("POST", "/api/telnyx/order-number", { phoneNumber });
      const updated = { ...safeUser, voiceCredits: safeUser.voiceCredits - 5 };
      await updateUser(updated);
      setMessage({ text: `Number ${phoneNumber} purchased! -5 Voice Credits`, type: "success" });
      setAvailableNumbers(prev => prev.filter(n => n.phoneNumber !== phoneNumber));
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setMessage({ text: "Could not purchase number. Try again.", type: "error" });
    } finally {
      setPurchasingNumber(null);
    }
  };

  const pickVoiceFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["audio/*"],
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        setVoiceFile({ uri: asset.uri, name: asset.name || "voice_sample.wav" });
        if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch {
      Alert.alert("Error", "Could not pick file");
    }
  };

  const submitAgentRequest = async () => {
    if (!user || !safeUser || !voiceFile || !agentPrompt.trim()) return;
    if (voiceCredits < 50) {
      setMessage({ text: "You need at least 50 Voice Credits to create an agent", type: "error" });
      return;
    }
    setSubmitting(true);
    try {
      const request: VoiceRequest = {
        id: generateId(),
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        voiceFileUri: voiceFile.uri,
        voiceFileName: voiceFile.name,
        prompt: agentPrompt.trim(),
        assignedNumber: "",
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      await saveVoiceRequest(request);
      const updated = { ...safeUser, voiceCredits: safeUser.voiceCredits - 50 };
      await updateUser(updated);
      setMessage({ text: "Agent request submitted! -50 Voice Credits", type: "success" });
      setVoiceFile(null);
      setAgentPrompt("");
      loadMyRequests();
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setMessage({ text: "Could not submit request. Try again.", type: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  const openPayPal = () => {
    const url = "https://www.paypal.com/ncp/payment/H3E7A5NBU3L92";
    if (Platform.OS === "web") {
      window.open(url, "_blank");
    } else {
      Linking.openURL(url);
    }
  };

  const tabs: { key: VoiceTab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: "credits", label: "Voice Credits", icon: "wallet-outline" },
    { key: "numbers", label: "Get Number", icon: "call-outline" },
    { key: "create", label: "Create Agent", icon: "mic-outline" },
  ];

  const renderCreditsTab = () => (
    <ScrollView style={styles.tabContent} contentContainerStyle={{ paddingBottom: 120 }}>
      <View style={styles.creditCard}>
        <LinearGradient
          colors={["#1a2a4a", "#0f1b30"]}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />
        <View style={styles.creditCardInner}>
          <Text style={styles.creditLabel}>Voice Credits</Text>
          <Text style={styles.creditAmount}>{voiceCredits}</Text>
          <View style={styles.creditDivider} />
          <Text style={styles.creditSub}>
            {hasPaid ? "PayPal verified account" : "No PayPal payment on file"}
          </Text>
        </View>
      </View>

      <View style={styles.pricingCard}>
        <Text style={styles.sectionTitle}>Voice Credit Pricing</Text>
        <View style={styles.pricingRow}>
          <View style={styles.pricingItem}>
            <Ionicons name="call" size={20} color={C.tint} />
            <Text style={styles.pricingLabel}>Buy Number</Text>
            <Text style={styles.pricingCost}>5 credits</Text>
          </View>
          <View style={styles.pricingItem}>
            <Ionicons name="person" size={20} color="#8B5CF6" />
            <Text style={styles.pricingLabel}>Create Agent</Text>
            <Text style={styles.pricingCost}>50 credits</Text>
          </View>
        </View>
      </View>

      <View style={styles.paypalSection}>
        <Text style={styles.sectionTitle}>Purchase Voice Credits</Text>
        <Text style={styles.sectionSub}>
          Voice Credits are separate from normal credits. They can only be purchased via PayPal and are used for phone numbers and AI agent creation.
        </Text>

        {Platform.OS === "web" ? (
          <View style={styles.paypalBtnContainer}>
            <Pressable style={styles.paypalBtn} onPress={openPayPal}>
              <Ionicons name="logo-paypal" size={22} color="#FFF" />
              <Text style={styles.paypalBtnText}>Buy Voice Credits via PayPal</Text>
            </Pressable>
            <Text style={styles.paypalNote}>
              After payment, credits will be added by admin within 24 hours.
            </Text>
          </View>
        ) : (
          <View style={styles.paypalBtnContainer}>
            <Pressable style={styles.paypalBtn} onPress={openPayPal}>
              <Ionicons name="logo-paypal" size={22} color="#FFF" />
              <Text style={styles.paypalBtnText}>Buy Voice Credits via PayPal</Text>
            </Pressable>
            <Text style={styles.paypalNote}>
              After payment, credits will be added by admin within 24 hours.
            </Text>
          </View>
        )}
      </View>

      <View style={styles.infoCard}>
        <Ionicons name="information-circle-outline" size={20} color={C.tint} />
        <Text style={styles.infoText}>
          Voice Credits cannot be earned from free trials or ads. They are exclusively purchased via PayPal for voice assistant features.
        </Text>
      </View>
    </ScrollView>
  );

  const renderNumbersTab = () => (
    <ScrollView style={styles.tabContent} contentContainerStyle={{ paddingBottom: 120 }}>
      {!hasPaid ? (
        <View style={styles.lockedCard}>
          <Ionicons name="lock-closed" size={40} color="rgba(148,163,184,0.5)" />
          <Text style={styles.lockedTitle}>Payment Required</Text>
          <Text style={styles.lockedSub}>
            Please purchase Voice Credits first to access phone numbers.
          </Text>
          <Pressable style={styles.goToCreditsBtn} onPress={() => setActiveTab("credits")}>
            <Text style={styles.goToCreditsText}>Go to Voice Credits</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={styles.creditBadge}>
            <Ionicons name="wallet" size={16} color={C.tint} />
            <Text style={styles.creditBadgeText}>{voiceCredits} Voice Credits</Text>
            <Text style={styles.creditBadgeCost}>5 credits per number</Text>
          </View>

          <Pressable
            style={styles.loadNumbersBtn}
            onPress={fetchAvailableNumbers}
            disabled={numbersLoading}
          >
            {numbersLoading ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <>
                <Ionicons name="search" size={18} color="#FFF" />
                <Text style={styles.loadNumbersBtnText}>Search Available Numbers</Text>
              </>
            )}
          </Pressable>

          {availableNumbers.length > 0 && (
            <View style={styles.numbersList}>
              {availableNumbers.map((num) => (
                <View key={num.phoneNumber} style={styles.numberCard}>
                  <View style={styles.numberInfo}>
                    <Text style={styles.numberPhone}>{num.phoneNumber}</Text>
                    <Text style={styles.numberRegion}>
                      {num.locality || num.region || "UK"}
                    </Text>
                  </View>
                  <Pressable
                    style={[
                      styles.buyNumberBtn,
                      voiceCredits < 5 && styles.buyNumberBtnDisabled,
                    ]}
                    onPress={() => {
                      Alert.alert(
                        "Buy Number",
                        `Purchase ${num.phoneNumber} for 5 Voice Credits?`,
                        [
                          { text: "Cancel", style: "cancel" },
                          { text: "Buy", onPress: () => purchaseNumber(num.phoneNumber) },
                        ]
                      );
                    }}
                    disabled={voiceCredits < 5 || purchasingNumber === num.phoneNumber}
                  >
                    {purchasingNumber === num.phoneNumber ? (
                      <ActivityIndicator size="small" color="#FFF" />
                    ) : (
                      <Text style={styles.buyNumberBtnText}>5 cr</Text>
                    )}
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          {availableNumbers.length === 0 && !numbersLoading && (
            <View style={styles.emptyState}>
              <Ionicons name="call-outline" size={36} color="rgba(148,163,184,0.4)" />
              <Text style={styles.emptyText}>
                Tap "Search Available Numbers" to find phone numbers for your voice assistant.
              </Text>
            </View>
          )}
        </>
      )}
    </ScrollView>
  );

  const renderCreateTab = () => (
    <ScrollView style={styles.tabContent} contentContainerStyle={{ paddingBottom: 120 }}>
      {!hasPaid ? (
        <View style={styles.lockedCard}>
          <Ionicons name="lock-closed" size={40} color="rgba(148,163,184,0.5)" />
          <Text style={styles.lockedTitle}>Payment Required</Text>
          <Text style={styles.lockedSub}>
            Please purchase Voice Credits first to create a voice agent.
          </Text>
          <Pressable style={styles.goToCreditsBtn} onPress={() => setActiveTab("credits")}>
            <Text style={styles.goToCreditsText}>Go to Voice Credits</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={styles.creditBadge}>
            <Ionicons name="wallet" size={16} color={C.tint} />
            <Text style={styles.creditBadgeText}>{voiceCredits} Voice Credits</Text>
            <Text style={styles.creditBadgeCost}>50 credits to create agent</Text>
          </View>

          <View style={styles.uploadSection}>
            <Text style={styles.sectionTitle}>Upload Your Voice</Text>
            <Text style={styles.sectionSub}>
              Upload an audio file of your voice. This will be used to clone your voice for the AI assistant.
            </Text>
            <Pressable style={styles.uploadBtn} onPress={pickVoiceFile}>
              <Ionicons
                name={voiceFile ? "checkmark-circle" : "cloud-upload-outline"}
                size={24}
                color={voiceFile ? C.tint : "rgba(148,163,184,0.7)"}
              />
              <Text style={[styles.uploadBtnText, voiceFile && { color: C.tint }]}>
                {voiceFile ? voiceFile.name : "Tap to select audio file"}
              </Text>
            </Pressable>
          </View>

          <View style={styles.promptSection}>
            <Text style={styles.sectionTitle}>Assistant Behaviour</Text>
            <Text style={styles.sectionSub}>
              Describe how your AI assistant should behave when answering calls.
            </Text>
            <TextInput
              style={styles.promptInput}
              value={agentPrompt}
              onChangeText={setAgentPrompt}
              placeholder="e.g. Answer as a friendly receptionist for my dental practice. Take appointment bookings and answer FAQs about our services..."
              placeholderTextColor="rgba(148,163,184,0.5)"
              multiline
              maxLength={2000}
              textAlignVertical="top"
            />
            <Text style={styles.charCount}>{agentPrompt.length}/2000</Text>
          </View>

          <Pressable
            style={[
              styles.createAgentBtn,
              (!voiceFile || !agentPrompt.trim() || voiceCredits < 50 || submitting) && styles.createAgentBtnDisabled,
            ]}
            onPress={() => {
              Alert.alert(
                "Create Agent",
                "This will cost 50 Voice Credits. Your voice and prompt will be sent to the admin for processing. Continue?",
                [
                  { text: "Cancel", style: "cancel" },
                  { text: "Create", onPress: submitAgentRequest },
                ]
              );
            }}
            disabled={!voiceFile || !agentPrompt.trim() || voiceCredits < 50 || submitting}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <>
                <Ionicons name="mic" size={20} color="#FFF" />
                <Text style={styles.createAgentBtnText}>Create Your Agent (50 credits)</Text>
              </>
            )}
          </Pressable>

          {voiceCredits < 50 && (
            <View style={styles.insufficientCard}>
              <Ionicons name="warning-outline" size={18} color="#F59E0B" />
              <Text style={styles.insufficientText}>
                You need 50 Voice Credits. Currently have {voiceCredits}.
              </Text>
              <Pressable onPress={() => setActiveTab("credits")}>
                <Text style={styles.buyMoreLink}>Buy more</Text>
              </Pressable>
            </View>
          )}

          {myRequests.length > 0 && (
            <View style={styles.requestsSection}>
              <Text style={styles.sectionTitle}>Your Requests</Text>
              {myRequests.map((req) => (
                <View key={req.id} style={styles.requestCard}>
                  <View style={styles.requestHeader}>
                    <View style={[
                      styles.statusBadge,
                      req.status === "complete" && styles.statusComplete,
                      req.status === "in_progress" && styles.statusProgress,
                    ]}>
                      <Text style={styles.statusText}>{req.status.replace("_", " ")}</Text>
                    </View>
                    <Text style={styles.requestDate}>
                      {new Date(req.createdAt).toLocaleDateString()}
                    </Text>
                  </View>
                  <Text style={styles.requestPrompt} numberOfLines={2}>
                    {req.prompt}
                  </Text>
                  {req.assignedNumber ? (
                    <Text style={styles.requestNumber}>{req.assignedNumber}</Text>
                  ) : null}
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );

  if (isGuest) {
    return (
      <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 + insets.top : insets.top }]}>
        <View style={styles.lockedCard}>
          <Ionicons name="lock-closed" size={40} color="rgba(148,163,184,0.5)" />
          <Text style={styles.lockedTitle}>Sign Up Required</Text>
          <Text style={styles.lockedSub}>Create an account to access Voice Assistant features.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 67 + insets.top : insets.top }]}>
      {message && (
        <Pressable
          style={[styles.messageBar, message.type === "error" ? styles.messageError : styles.messageSuccess]}
          onPress={() => setMessage(null)}
        >
          <Text style={styles.messageText}>{message.text}</Text>
          <Ionicons name="close" size={16} color="#FFF" />
        </Pressable>
      )}

      <View style={styles.header}>
        <Text style={styles.headerTitle}>Voice Assistant</Text>
        <View style={styles.vcBadge}>
          <Ionicons name="wallet" size={14} color={C.tint} />
          <Text style={styles.vcBadgeText}>{voiceCredits} VC</Text>
        </View>
      </View>

      <View style={styles.tabBar}>
        {tabs.map((tab) => (
          <Pressable
            key={tab.key}
            style={[styles.tabItem, activeTab === tab.key && styles.tabItemActive]}
            onPress={() => {
              setActiveTab(tab.key);
              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }}
          >
            <Ionicons
              name={tab.icon}
              size={18}
              color={activeTab === tab.key ? C.tint : "rgba(148,163,184,0.6)"}
            />
            <Text style={[styles.tabLabel, activeTab === tab.key && styles.tabLabelActive]}>
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {activeTab === "credits" && renderCreditsTab()}
      {activeTab === "numbers" && renderNumbersTab()}
      {activeTab === "create" && renderCreateTab()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  headerTitle: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    color: C.text,
  },
  vcBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0,212,170,0.1)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(0,212,170,0.2)",
  },
  vcBadgeText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: C.tint,
  },
  tabBar: {
    flexDirection: "row",
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 8,
  },
  tabItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "rgba(30,40,60,0.5)",
  },
  tabItemActive: {
    backgroundColor: "rgba(0,212,170,0.12)",
    borderWidth: 1,
    borderColor: "rgba(0,212,170,0.3)",
  },
  tabLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: "rgba(148,163,184,0.6)",
  },
  tabLabelActive: {
    color: C.tint,
  },
  tabContent: {
    flex: 1,
    paddingHorizontal: 16,
  },
  creditCard: {
    borderRadius: 20,
    overflow: "hidden",
    marginTop: 8,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "rgba(0,212,170,0.2)",
  },
  creditCardInner: {
    padding: 24,
    alignItems: "center",
  },
  creditLabel: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: "rgba(148,163,184,0.8)",
    marginBottom: 4,
  },
  creditAmount: {
    fontSize: 48,
    fontFamily: "Inter_700Bold",
    color: C.tint,
  },
  creditDivider: {
    width: 60,
    height: 2,
    backgroundColor: "rgba(0,212,170,0.3)",
    marginVertical: 12,
    borderRadius: 1,
  },
  creditSub: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "rgba(148,163,184,0.6)",
  },
  pricingCard: {
    backgroundColor: "rgba(30,40,60,0.5)",
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "rgba(100,116,139,0.15)",
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: C.text,
    marginBottom: 12,
  },
  sectionSub: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "rgba(148,163,184,0.7)",
    marginBottom: 16,
    lineHeight: 18,
  },
  pricingRow: {
    flexDirection: "row",
    gap: 12,
  },
  pricingItem: {
    flex: 1,
    alignItems: "center",
    backgroundColor: "rgba(20,30,50,0.6)",
    borderRadius: 12,
    padding: 16,
    gap: 6,
  },
  pricingLabel: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: C.text,
  },
  pricingCost: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: C.tint,
  },
  paypalSection: {
    backgroundColor: "rgba(30,40,60,0.5)",
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "rgba(100,116,139,0.15)",
  },
  paypalBtnContainer: {
    alignItems: "center",
    gap: 12,
  },
  paypalBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#0070BA",
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
    width: "100%",
  },
  paypalBtnText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: "#FFF",
  },
  paypalNote: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "rgba(148,163,184,0.5)",
    textAlign: "center",
  },
  infoCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: "rgba(0,212,170,0.06)",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(0,212,170,0.12)",
  },
  infoText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "rgba(148,163,184,0.7)",
    lineHeight: 18,
  },
  lockedCard: {
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
    margin: 20,
    backgroundColor: "rgba(30,40,60,0.5)",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(100,116,139,0.15)",
    gap: 12,
  },
  lockedTitle: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    color: C.text,
  },
  lockedSub: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "rgba(148,163,184,0.7)",
    textAlign: "center",
    lineHeight: 20,
  },
  goToCreditsBtn: {
    backgroundColor: C.tint,
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 10,
    marginTop: 8,
  },
  goToCreditsText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: "#000",
  },
  creditBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(0,212,170,0.08)",
    padding: 12,
    borderRadius: 12,
    marginTop: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(0,212,170,0.15)",
  },
  creditBadgeText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: C.tint,
    flex: 1,
  },
  creditBadgeCost: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "rgba(148,163,184,0.6)",
  },
  loadNumbersBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: C.tint,
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 16,
  },
  loadNumbersBtnText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: "#000",
  },
  numbersList: {
    gap: 8,
  },
  numberCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(30,40,60,0.6)",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(100,116,139,0.12)",
  },
  numberInfo: {
    flex: 1,
  },
  numberPhone: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: C.text,
  },
  numberRegion: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "rgba(148,163,184,0.6)",
    marginTop: 2,
  },
  buyNumberBtn: {
    backgroundColor: C.tint,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  buyNumberBtnDisabled: {
    backgroundColor: "rgba(100,116,139,0.3)",
  },
  buyNumberBtnText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: "#000",
  },
  emptyState: {
    alignItems: "center",
    padding: 40,
    gap: 12,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "rgba(148,163,184,0.5)",
    textAlign: "center",
    lineHeight: 20,
  },
  uploadSection: {
    backgroundColor: "rgba(30,40,60,0.5)",
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(100,116,139,0.15)",
  },
  uploadBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderWidth: 1.5,
    borderColor: "rgba(0,212,170,0.3)",
    borderStyle: "dashed",
    borderRadius: 12,
    paddingVertical: 20,
  },
  uploadBtnText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: "rgba(148,163,184,0.6)",
  },
  promptSection: {
    backgroundColor: "rgba(30,40,60,0.5)",
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(100,116,139,0.15)",
  },
  promptInput: {
    backgroundColor: "rgba(15,25,40,0.8)",
    borderRadius: 12,
    padding: 14,
    color: C.text,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    minHeight: 120,
    borderWidth: 1,
    borderColor: "rgba(0,212,170,0.15)",
  },
  charCount: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: "rgba(148,163,184,0.4)",
    textAlign: "right",
    marginTop: 6,
  },
  createAgentBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#8B5CF6",
    paddingVertical: 16,
    borderRadius: 14,
    marginBottom: 16,
  },
  createAgentBtnDisabled: {
    backgroundColor: "rgba(100,116,139,0.3)",
  },
  createAgentBtnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: "#FFF",
  },
  insufficientCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(245,158,11,0.08)",
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.2)",
  },
  insufficientText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "rgba(245,158,11,0.8)",
  },
  buyMoreLink: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: C.tint,
  },
  requestsSection: {
    marginTop: 8,
  },
  requestCard: {
    backgroundColor: "rgba(30,40,60,0.5)",
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "rgba(100,116,139,0.12)",
  },
  requestHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  statusBadge: {
    backgroundColor: "rgba(245,158,11,0.15)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusComplete: {
    backgroundColor: "rgba(0,212,170,0.15)",
  },
  statusProgress: {
    backgroundColor: "rgba(59,130,246,0.15)",
  },
  statusText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: C.text,
    textTransform: "capitalize",
  },
  requestDate: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: "rgba(148,163,184,0.5)",
  },
  requestPrompt: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "rgba(148,163,184,0.7)",
    lineHeight: 18,
  },
  requestNumber: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: C.tint,
    marginTop: 6,
  },
  messageBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginHorizontal: 16,
    borderRadius: 10,
    marginBottom: 4,
  },
  messageSuccess: {
    backgroundColor: "rgba(0,212,170,0.15)",
  },
  messageError: {
    backgroundColor: "rgba(239,68,68,0.15)",
  },
  messageText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: "#FFF",
    flex: 1,
  },
});
