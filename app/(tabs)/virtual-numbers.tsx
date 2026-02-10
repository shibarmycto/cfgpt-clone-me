import React, { useState, useCallback } from "react";
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
  TextInput,
  Platform,
  Alert,
  ActivityIndicator,
  Modal,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import Colors from "@/constants/colors";

const C = Colors.light;

interface VirtualNumber {
  id: string;
  phoneNumber: string;
  sipUsername: string;
  sipPassword: string;
  sipDomain: string;
  sipPort: number;
  displayName: string;
  agentName: string;
  agentGreeting: string;
  agentPersonality: string;
  agentSystemPrompt: string;
  ttsVoice: string;
  voiceSampleId?: string;
  isActive: boolean;
  callsHandled: number;
  lastCallAt: string | null;
  createdAt: string;
  dailyCreditCost: number;
  maxMinutesPerDay: number;
  totalMinutesUsed: number;
}

type TtsVoiceId = "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";

const TTS_VOICES: { id: TtsVoiceId; name: string; desc: string; color: string }[] = [
  { id: "nova", name: "Nova", desc: "Warm female", color: "#FF69B4" },
  { id: "alloy", name: "Alloy", desc: "Neutral", color: "#00E676" },
  { id: "echo", name: "Echo", desc: "Deep male", color: "#448AFF" },
  { id: "fable", name: "Fable", desc: "British", color: "#FFD700" },
  { id: "onyx", name: "Onyx", desc: "Deep bass", color: "#B388FF" },
  { id: "shimmer", name: "Shimmer", desc: "Soft female", color: "#FF8A65" },
];

interface ServerVoiceSample {
  id: string;
  userId: string;
  name: string;
  mimeType: string;
  duration: number;
  isActive: boolean;
  createdAt: string;
}

type TabId = "numbers" | "add" | "guide";

const PERSONALITIES = [
  { id: "urban", name: "CF Urban", color: "#00E676", desc: "Streetwise, casual" },
  { id: "trader", name: "CF Trader", color: "#FFD700", desc: "Posh, professional" },
  { id: "eliza", name: "CF Eliza", color: "#FF69B4", desc: "Warm, supportive" },
];

const DAILY_CREDIT_COST = 30;
const MAX_MINUTES = 3000;

export default function VirtualNumbersScreen() {
  const insets = useSafeAreaInsets();
  const { user, isGuest, updateUser } = useAuth();
  const webTopInset = Platform.OS === "web" ? 67 : 0;

  const [activeTab, setActiveTab] = useState<TabId>("numbers");
  const [numbers, setNumbers] = useState<VirtualNumber[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedNumber, setSelectedNumber] = useState<VirtualNumber | null>(null);
  const [showAgentModal, setShowAgentModal] = useState(false);
  const [testResponse, setTestResponse] = useState("");
  const [testing, setTesting] = useState(false);

  const [phoneNumber, setPhoneNumber] = useState("");
  const [sipUsername, setSipUsername] = useState("");
  const [sipPassword, setSipPassword] = useState("");
  const [sipDomain, setSipDomain] = useState("sip.switchboardfree.co.uk");
  const [displayName, setDisplayName] = useState("");
  const [agentName, setAgentName] = useState("AI Receptionist");
  const [agentGreeting, setAgentGreeting] = useState("Hello, thank you for calling. How can I help you today?");
  const [agentPersonality, setAgentPersonality] = useState("urban");
  const [agentSystemPrompt, setAgentSystemPrompt] = useState("You are a professional AI receptionist. Be helpful, friendly, and concise. Answer questions about the business and take messages when needed.");
  const [ttsVoice, setTtsVoice] = useState<TtsVoiceId>("nova");
  const [voiceSamples, setVoiceSamples] = useState<ServerVoiceSample[]>([]);
  const [selectedVoiceSampleId, setSelectedVoiceSampleId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadNumbers = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await apiRequest("GET", `/api/virtual-numbers?userId=${user.id}`);
      const data = await res.json();
      setNumbers(data);
    } catch (e) {
    } finally {
      setLoading(false);
    }
  }, [user]);

  const loadVoiceSamples = useCallback(async () => {
    if (!user) return;
    try {
      const res = await apiRequest("GET", `/api/voice-samples?userId=${user.id}`);
      const data = await res.json();
      setVoiceSamples(data);
    } catch (e) {
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      loadNumbers();
      loadVoiceSamples();
    }, [loadNumbers, loadVoiceSamples])
  );

  const handleAddNumber = async () => {
    if (!phoneNumber.trim() || !sipUsername.trim() || !sipPassword.trim()) {
      Alert.alert("Missing Info", "Please fill in phone number, SIP username, and SIP password.");
      return;
    }
    if (!user) return;

    if (user.credits < DAILY_CREDIT_COST) {
      Alert.alert(
        "Not Enough Credits",
        `You need at least ${DAILY_CREDIT_COST} credits to activate an AI phone agent. This service costs ${DAILY_CREDIT_COST} credits per day for unlimited inbound calls (up to ${MAX_MINUTES.toLocaleString()} minutes). Visit the Credits tab to top up.`
      );
      return;
    }

    setSaving(true);
    try {
      await apiRequest("POST", "/api/virtual-numbers", {
        userId: user.id,
        phoneNumber: phoneNumber.trim(),
        sipUsername: sipUsername.trim(),
        sipPassword: sipPassword.trim(),
        sipDomain: sipDomain.trim() || "sip.switchboardfree.co.uk",
        displayName: displayName.trim() || phoneNumber.trim(),
        agentName: agentName.trim(),
        agentGreeting: agentGreeting.trim(),
        agentPersonality,
        agentSystemPrompt: agentSystemPrompt.trim(),
        ttsVoice,
        voiceSampleId: selectedVoiceSampleId || undefined,
      });

      const updatedCredits = user.credits - DAILY_CREDIT_COST;
      await updateUser({ ...user, credits: Math.max(0, updatedCredits) });

      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        "Number Connected",
        `Your AI agent is now live! ${DAILY_CREDIT_COST} credits have been deducted for today.\n\nMake sure you've configured the webhook in Switchboard Free (see the Setup Guide tab).`
      );
      setActiveTab("numbers");
      loadNumbers();
      resetForm();
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to add number");
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setPhoneNumber("");
    setSipUsername("");
    setSipPassword("");
    setSipDomain("sip.switchboardfree.co.uk");
    setDisplayName("");
    setAgentName("AI Receptionist");
    setAgentGreeting("Hello, thank you for calling. How can I help you today?");
    setAgentPersonality("urban");
    setAgentSystemPrompt("You are a professional AI receptionist. Be helpful, friendly, and concise. Answer questions about the business and take messages when needed.");
    setTtsVoice("nova");
    setSelectedVoiceSampleId(null);
  };

  const handleToggleActive = async (num: VirtualNumber) => {
    if (!num.isActive && user && user.credits < DAILY_CREDIT_COST) {
      Alert.alert("Not Enough Credits", `You need at least ${DAILY_CREDIT_COST} credits to reactivate this number.`);
      return;
    }
    try {
      await apiRequest("PUT", `/api/virtual-numbers/${num.id}`, { isActive: !num.isActive });
      if (!num.isActive && user) {
        await updateUser({ ...user, credits: Math.max(0, user.credits - DAILY_CREDIT_COST) });
      }
      loadNumbers();
    } catch (e: any) {
      Alert.alert("Error", e.message);
    }
  };

  const handleDeleteNumber = async (num: VirtualNumber) => {
    Alert.alert("Remove Number", `Remove ${num.phoneNumber} from the system? No further credits will be charged.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove", style: "destructive", onPress: async () => {
          try {
            await apiRequest("DELETE", `/api/virtual-numbers/${num.id}`);
            if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            loadNumbers();
          } catch (e: any) {
            Alert.alert("Error", e.message);
          }
        },
      },
    ]);
  };

  const handleTestAgent = async (num: VirtualNumber) => {
    setSelectedNumber(num);
    setShowAgentModal(true);
    setTestResponse("");
    setTesting(true);
    try {
      const res = await apiRequest("POST", `/api/virtual-numbers/${num.id}/test`, {
        message: "Hello, I'm calling about your services. Can you help me?",
      });
      const data = await res.json();
      setTestResponse(data.response || "No response");
    } catch (e: any) {
      setTestResponse("Error: " + (e.message || "Test failed"));
    } finally {
      setTesting(false);
    }
  };

  const webhookUrl = `${getApiUrl()}api/webhook/switchboard`;

  if (isGuest) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + webTopInset }]}>
        <View style={styles.guestBlock}>
          <Ionicons name="call-outline" size={48} color={C.textTertiary} />
          <Text style={styles.guestTitle}>Virtual Numbers</Text>
          <Text style={styles.guestDesc}>Sign in to set up AI-powered virtual phone numbers that answer your calls</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + webTopInset }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Virtual Numbers</Text>
        <Text style={styles.headerSub}>AI-powered phone agents  |  {DAILY_CREDIT_COST} credits/day</Text>
      </View>

      <View style={styles.tabRow}>
        {([
          { id: "numbers" as TabId, label: "My Numbers", icon: "call" as const },
          { id: "add" as TabId, label: "Add Number", icon: "add-circle" as const },
          { id: "guide" as TabId, label: "Setup Guide", icon: "book" as const },
        ]).map((t) => (
          <Pressable
            key={t.id}
            style={[styles.tabBtn, activeTab === t.id && styles.tabBtnActive]}
            onPress={() => setActiveTab(t.id)}
          >
            <Ionicons name={t.icon} size={16} color={activeTab === t.id ? C.tint : C.textTertiary} />
            <Text style={[styles.tabLabel, activeTab === t.id && styles.tabLabelActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
        {activeTab === "numbers" && (
          <>
            <View style={styles.pricingBanner}>
              <View style={styles.pricingLeft}>
                <Ionicons name="diamond" size={20} color={C.tint} />
                <View>
                  <Text style={styles.pricingTitle}>{DAILY_CREDIT_COST} Credits / Day</Text>
                  <Text style={styles.pricingDesc}>Unlimited inbound calls up to {MAX_MINUTES.toLocaleString()} mins</Text>
                </View>
              </View>
              <View style={styles.pricingBadge}>
                <Text style={styles.pricingBadgeText}>{user?.credits ?? 0} credits</Text>
              </View>
            </View>

            <View style={styles.webhookCard}>
              <View style={styles.webhookHeader}>
                <Ionicons name="link" size={18} color={C.tint} />
                <Text style={styles.webhookTitle}>Your Webhook URL</Text>
              </View>
              <Text style={styles.webhookDesc}>
                Copy this URL and paste it into Switchboard Free (see Setup Guide for full instructions)
              </Text>
              <View style={styles.webhookUrlBox}>
                <Text style={styles.webhookUrl} selectable>{webhookUrl}</Text>
              </View>
              <View style={styles.webhookInfoRow}>
                <Text style={styles.webhookInfoLabel}>Method:</Text>
                <Text style={styles.webhookInfoValue}>GET</Text>
              </View>
              <View style={styles.webhookInfoRow}>
                <Text style={styles.webhookInfoLabel}>Content Type:</Text>
                <Text style={styles.webhookInfoValue}>application/x-www-form-urlencoded</Text>
              </View>
            </View>

            {loading ? (
              <ActivityIndicator color={C.tint} style={{ marginTop: 40 }} />
            ) : numbers.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="phone-portrait-outline" size={48} color={C.textTertiary} />
                <Text style={styles.emptyTitle}>No numbers connected yet</Text>
                <Text style={styles.emptyDesc}>
                  Connect a Switchboard Free number to an AI agent that answers your calls 24/7
                </Text>
                <Pressable style={styles.addFirstBtn} onPress={() => setActiveTab("guide")}>
                  <Ionicons name="book" size={18} color="#000" />
                  <Text style={styles.addFirstLabel}>Read Setup Guide</Text>
                </Pressable>
                <Pressable style={[styles.addFirstBtn, { backgroundColor: C.card, borderWidth: 1, borderColor: C.tint, marginTop: 8 }]} onPress={() => setActiveTab("add")}>
                  <Ionicons name="add" size={18} color={C.tint} />
                  <Text style={[styles.addFirstLabel, { color: C.tint }]}>Add Your First Number</Text>
                </Pressable>
              </View>
            ) : (
              numbers.map((num) => (
                <View key={num.id} style={styles.numberCard}>
                  <View style={styles.numberHeader}>
                    <View style={styles.numberInfo}>
                      <Text style={styles.numberPhone}>{num.phoneNumber}</Text>
                      <Text style={styles.numberName}>{num.displayName}</Text>
                    </View>
                    <Pressable
                      style={[styles.statusDot, { backgroundColor: num.isActive ? C.success : C.danger }]}
                      onPress={() => handleToggleActive(num)}
                    >
                      <Text style={styles.statusLabel}>{num.isActive ? "Active" : "Off"}</Text>
                    </Pressable>
                  </View>

                  <View style={styles.numberMeta}>
                    <View style={styles.metaItem}>
                      <Ionicons name="person" size={14} color={C.textTertiary} />
                      <Text style={styles.metaText}>{num.agentName}</Text>
                    </View>
                    <View style={styles.metaItem}>
                      <Ionicons name="call" size={14} color={C.textTertiary} />
                      <Text style={styles.metaText}>{num.callsHandled} calls</Text>
                    </View>
                  </View>

                  <View style={styles.billingRow}>
                    <View style={styles.billingItem}>
                      <Ionicons name="diamond" size={12} color={C.warning} />
                      <Text style={styles.billingText}>{num.dailyCreditCost} credits/day</Text>
                    </View>
                    <View style={styles.billingItem}>
                      <Ionicons name="time" size={12} color={C.textTertiary} />
                      <Text style={styles.billingText}>{Math.round(num.totalMinutesUsed)} / {num.maxMinutesPerDay.toLocaleString()} mins used</Text>
                    </View>
                  </View>

                  <View style={styles.numberMeta}>
                    <View style={styles.metaItem}>
                      <Ionicons name="mic" size={14} color="#FF69B4" />
                      <Text style={styles.metaText}>
                        Voice: {TTS_VOICES.find((v) => v.id === num.ttsVoice)?.name || num.ttsVoice || "Nova"}
                        {num.voiceSampleId ? " + Custom Sample" : ""}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.numberSip}>
                    <Text style={styles.sipLabel}>SIP: {num.sipUsername} @ {num.sipDomain}</Text>
                  </View>

                  <View style={styles.numberActions}>
                    <Pressable style={styles.actionBtn} onPress={() => handleTestAgent(num)}>
                      <Ionicons name="play" size={16} color={C.tint} />
                      <Text style={[styles.actionLabel, { color: C.tint }]}>Test Agent</Text>
                    </Pressable>
                    <Pressable style={styles.actionBtn} onPress={() => handleDeleteNumber(num)}>
                      <Ionicons name="trash" size={16} color={C.danger} />
                      <Text style={[styles.actionLabel, { color: C.danger }]}>Remove</Text>
                    </Pressable>
                  </View>
                </View>
              ))
            )}
          </>
        )}

        {activeTab === "guide" && (
          <>
            <View style={styles.guideIntro}>
              <Ionicons name="information-circle" size={22} color={C.tint} />
              <Text style={styles.guideIntroTitle}>How to Connect Your Number to an AI Agent</Text>
              <Text style={styles.guideIntroDesc}>
                Follow these steps to set up your Switchboard Free number so our AI answers your calls automatically. It takes about 5 minutes.
              </Text>
            </View>

            <View style={styles.pricingCard}>
              <Text style={styles.pricingCardTitle}>Service Pricing</Text>
              <View style={styles.pricingDetail}>
                <Ionicons name="diamond" size={16} color={C.tint} />
                <Text style={styles.pricingDetailText}>{DAILY_CREDIT_COST} credits per day per number</Text>
              </View>
              <View style={styles.pricingDetail}>
                <Ionicons name="call" size={16} color={C.success} />
                <Text style={styles.pricingDetailText}>Unlimited inbound calls included</Text>
              </View>
              <View style={styles.pricingDetail}>
                <Ionicons name="time" size={16} color={C.warning} />
                <Text style={styles.pricingDetailText}>Up to {MAX_MINUTES.toLocaleString()} minutes per day</Text>
              </View>
              <View style={styles.pricingDetail}>
                <Ionicons name="flash" size={16} color={C.purple} />
                <Text style={styles.pricingDetailText}>AI answers calls 24/7 in your chosen personality</Text>
              </View>
              <View style={styles.pricingDetail}>
                <Ionicons name="close-circle" size={16} color={C.danger} />
                <Text style={styles.pricingDetailText}>Cancel anytime - just remove the number</Text>
              </View>
            </View>

            <View style={styles.guideSection}>
              <Text style={styles.guideSectionTitle}>Step 1: Get a Switchboard Free Account</Text>
              <Text style={styles.guideText}>
                Go to switchboardfree.co.uk and create an account. Purchase a virtual phone number (UK or international). Note down the number they give you.
              </Text>
            </View>

            <View style={styles.guideSection}>
              <Text style={styles.guideSectionTitle}>Step 2: Find Your SIP Credentials</Text>
              <Text style={styles.guideText}>
                In your Switchboard Free dashboard, go to your number settings. You'll find your SIP credentials:
              </Text>
              <View style={styles.credentialBox}>
                <CredentialRow label="SIP Username" example="26685.2yourname" />
                <CredentialRow label="SIP Password" example="Your assigned password" />
                <CredentialRow label="SIP Domain" example="sip.switchboardfree.co.uk" />
              </View>
              <Text style={styles.guideHint}>
                These are usually found under Settings, SIP Trunk, or Number Configuration in your Switchboard Free dashboard.
              </Text>
            </View>

            <View style={styles.guideSection}>
              <Text style={styles.guideSectionTitle}>Step 3: Set Up the Webhook in Switchboard Free</Text>
              <Text style={styles.guideText}>
                This is the most important step. The webhook tells Switchboard Free to send incoming calls to our AI agent.
              </Text>
              <View style={styles.webhookGuide}>
                <Text style={styles.webhookGuideLabel}>In Switchboard Free:</Text>
                <GuideStep num={1} text='Log into your Switchboard Free account' />
                <GuideStep num={2} text='Click on your number, then go to "Settings" or "Call Routing"' />
                <GuideStep num={3} text='Look for "Webhooks", "HTTP Request", or "URL Forwarding"' />
                <GuideStep num={4} text='Set the Destination/URL to:' />
                <View style={styles.webhookUrlBox}>
                  <Text style={styles.webhookUrl} selectable>{webhookUrl}</Text>
                </View>
                <GuideStep num={5} text='Set the Method to: GET' />
                <GuideStep num={6} text='Set Content Type to: application/x-www-form-urlencoded' />
              </View>
            </View>

            <View style={styles.guideSection}>
              <Text style={styles.guideSectionTitle}>Step 4: Configure the Webhook Body/Parameters</Text>
              <Text style={styles.guideText}>
                Switchboard Free needs to send us information about the incoming call. In the webhook settings, add these parameters:
              </Text>
              <View style={styles.bodyParamsCard}>
                <Text style={styles.bodyParamsTitle}>Required Webhook Parameters</Text>
                <Text style={styles.bodyParamsDesc}>
                  If Switchboard Free has a "Body" or "Parameters" section, add these fields. They use Switchboard Free's template variables to pass call info:
                </Text>
                <View style={styles.paramRow}>
                  <Text style={styles.paramKey}>cli</Text>
                  <Text style={styles.paramEquals}>=</Text>
                  <Text style={styles.paramValue}>{"{{cli}}"}</Text>
                  <Text style={styles.paramHint}>Caller's number</Text>
                </View>
                <View style={styles.paramRow}>
                  <Text style={styles.paramKey}>ddi</Text>
                  <Text style={styles.paramEquals}>=</Text>
                  <Text style={styles.paramValue}>{"{{ddi}}"}</Text>
                  <Text style={styles.paramHint}>Your number that was called</Text>
                </View>
                <View style={styles.paramRow}>
                  <Text style={styles.paramKey}>callId</Text>
                  <Text style={styles.paramEquals}>=</Text>
                  <Text style={styles.paramValue}>{"{{callid}}"}</Text>
                  <Text style={styles.paramHint}>Unique call ID</Text>
                </View>
                <View style={styles.paramRow}>
                  <Text style={styles.paramKey}>direction</Text>
                  <Text style={styles.paramEquals}>=</Text>
                  <Text style={styles.paramValue}>{"{{direction}}"}</Text>
                  <Text style={styles.paramHint}>Call direction (inbound)</Text>
                </View>
              </View>
              <View style={styles.fullUrlCard}>
                <Text style={styles.fullUrlLabel}>Full URL with parameters (if using GET query string):</Text>
                <View style={styles.webhookUrlBox}>
                  <Text style={styles.webhookUrl} selectable>
                    {webhookUrl}?cli={"{{cli}}"}&ddi={"{{ddi}}"}&callId={"{{callid}}"}&direction={"{{direction}}"}
                  </Text>
                </View>
                <Text style={styles.guideHint}>
                  Some Switchboard Free plans automatically include these parameters. If you see fields like "CLI", "DDI", or "Call ID" already listed, they may be sent automatically.
                </Text>
              </View>
            </View>

            <View style={styles.guideSection}>
              <Text style={styles.guideSectionTitle}>Step 5: Save and Test</Text>
              <Text style={styles.guideText}>
                Save the webhook settings in Switchboard Free, then come back here and:
              </Text>
              <GuideStep num={1} text='Go to the "Add Number" tab above' />
              <GuideStep num={2} text="Enter your phone number and SIP credentials" />
              <GuideStep num={3} text="Choose an AI personality for your agent" />
              <GuideStep num={4} text='Tap "Add Number & Connect Agent"' />
              <GuideStep num={5} text="Call your number from another phone to test it!" />
            </View>

            <View style={styles.guideSection}>
              <Text style={styles.guideSectionTitle}>Troubleshooting</Text>
              <View style={styles.faqItem}>
                <Text style={styles.faqQ}>AI isn't answering calls?</Text>
                <Text style={styles.faqA}>Double-check the webhook URL is exactly correct and the method is set to GET. Make sure your number is set to "Active" in the My Numbers tab.</Text>
              </View>
              <View style={styles.faqItem}>
                <Text style={styles.faqQ}>Getting a generic response?</Text>
                <Text style={styles.faqA}>Make sure the "ddi" parameter matches the phone number you entered when adding the number. Our system uses this to match calls to your agent.</Text>
              </View>
              <View style={styles.faqItem}>
                <Text style={styles.faqQ}>Can I use multiple numbers?</Text>
                <Text style={styles.faqA}>Yes! Each number can have its own AI personality, greeting, and instructions. Each number costs {DAILY_CREDIT_COST} credits/day.</Text>
              </View>
            </View>

            <Pressable style={styles.guideStartBtn} onPress={() => setActiveTab("add")}>
              <Ionicons name="add-circle" size={20} color="#000" />
              <Text style={styles.guideStartLabel}>Ready? Add Your Number Now</Text>
            </Pressable>
          </>
        )}

        {activeTab === "add" && (
          <>
            <View style={styles.costBanner}>
              <Ionicons name="diamond" size={18} color={C.warning} />
              <View style={{ flex: 1 }}>
                <Text style={styles.costBannerTitle}>Cost: {DAILY_CREDIT_COST} credits/day</Text>
                <Text style={styles.costBannerDesc}>Unlimited inbound calls up to {MAX_MINUTES.toLocaleString()} mins. Your balance: {user?.credits ?? 0} credits</Text>
              </View>
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="call" size={18} color={C.tint} />
                <Text style={styles.sectionTitle}>Phone Number</Text>
              </View>
              <Text style={styles.fieldHint}>
                Enter the number you purchased from Switchboard Free
              </Text>
              <TextInput
                style={styles.input}
                value={phoneNumber}
                onChangeText={setPhoneNumber}
                placeholder="e.g. +442073621038"
                placeholderTextColor={C.placeholder}
                keyboardType="phone-pad"
              />
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="key" size={18} color={C.warning} />
                <Text style={styles.sectionTitle}>SIP Credentials</Text>
              </View>
              <Text style={styles.fieldHint}>
                Find these in your Switchboard Free dashboard under number settings or SIP configuration
              </Text>

              <Text style={styles.fieldLabel}>SIP Username</Text>
              <TextInput
                style={styles.input}
                value={sipUsername}
                onChangeText={setSipUsername}
                placeholder="e.g. 26685.2yourname"
                placeholderTextColor={C.placeholder}
                autoCapitalize="none"
              />

              <Text style={styles.fieldLabel}>SIP Password</Text>
              <TextInput
                style={styles.input}
                value={sipPassword}
                onChangeText={setSipPassword}
                placeholder="Your SIP password"
                placeholderTextColor={C.placeholder}
                secureTextEntry
              />

              <Text style={styles.fieldLabel}>SIP Domain</Text>
              <TextInput
                style={styles.input}
                value={sipDomain}
                onChangeText={setSipDomain}
                placeholder="sip.switchboardfree.co.uk"
                placeholderTextColor={C.placeholder}
                autoCapitalize="none"
              />
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="person" size={18} color={C.accent} />
                <Text style={styles.sectionTitle}>Display Name</Text>
              </View>
              <TextInput
                style={styles.input}
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="Your business or personal name"
                placeholderTextColor={C.placeholder}
              />
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="hardware-chip" size={18} color={C.purple} />
                <Text style={styles.sectionTitle}>AI Agent Configuration</Text>
              </View>
              <Text style={styles.fieldHint}>
                Configure how your AI agent answers calls
              </Text>

              <Text style={styles.fieldLabel}>Agent Name</Text>
              <TextInput
                style={styles.input}
                value={agentName}
                onChangeText={setAgentName}
                placeholder="e.g. Sarah from Customer Support"
                placeholderTextColor={C.placeholder}
              />

              <Text style={styles.fieldLabel}>Greeting Message</Text>
              <TextInput
                style={[styles.input, styles.inputMultiline]}
                value={agentGreeting}
                onChangeText={setAgentGreeting}
                placeholder="What the agent says when answering a call"
                placeholderTextColor={C.placeholder}
                multiline
                numberOfLines={3}
              />

              <Text style={styles.fieldLabel}>Agent Personality</Text>
              <View style={styles.personalityRow}>
                {PERSONALITIES.map((p) => (
                  <Pressable
                    key={p.id}
                    style={[
                      styles.personalityCard,
                      agentPersonality === p.id && { borderColor: p.color, borderWidth: 2 },
                    ]}
                    onPress={() => setAgentPersonality(p.id)}
                  >
                    <View style={[styles.personalityDot, { backgroundColor: p.color }]} />
                    <Text style={styles.personalityName}>{p.name}</Text>
                    <Text style={styles.personalityDesc}>{p.desc}</Text>
                    {agentPersonality === p.id && (
                      <Ionicons name="checkmark-circle" size={18} color={p.color} style={styles.personalityCheck} />
                    )}
                  </Pressable>
                ))}
              </View>

              <Text style={styles.fieldLabel}>Custom Instructions</Text>
              <TextInput
                style={[styles.input, styles.inputMultiline]}
                value={agentSystemPrompt}
                onChangeText={setAgentSystemPrompt}
                placeholder="Tell the agent about your business, what to say, how to handle requests..."
                placeholderTextColor={C.placeholder}
                multiline
                numberOfLines={4}
              />
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="mic" size={18} color="#FF69B4" />
                <Text style={styles.sectionTitle}>AI Voice</Text>
              </View>
              <Text style={styles.fieldHint}>
                Choose how your AI agent sounds when answering calls
              </Text>

              <Text style={styles.fieldLabel}>TTS Voice</Text>
              <View style={styles.voiceGrid}>
                {TTS_VOICES.map((v) => (
                  <Pressable
                    key={v.id}
                    style={[
                      styles.voiceCard,
                      ttsVoice === v.id && !selectedVoiceSampleId && { borderColor: v.color, borderWidth: 2 },
                    ]}
                    onPress={() => {
                      setTtsVoice(v.id);
                      setSelectedVoiceSampleId(null);
                    }}
                  >
                    <View style={[styles.voiceDot, { backgroundColor: v.color }]} />
                    <Text style={styles.voiceName}>{v.name}</Text>
                    <Text style={styles.voiceDesc}>{v.desc}</Text>
                    {ttsVoice === v.id && !selectedVoiceSampleId && (
                      <Ionicons name="checkmark-circle" size={16} color={v.color} style={{ position: "absolute" as const, top: 6, right: 6 }} />
                    )}
                  </Pressable>
                ))}
              </View>

              {voiceSamples.length > 0 && (
                <>
                  <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Your Uploaded Voices</Text>
                  <Text style={[styles.fieldHint, { marginBottom: 8 }]}>
                    Use a voice you uploaded in the Voice tab
                  </Text>
                  {voiceSamples.map((vs) => (
                    <Pressable
                      key={vs.id}
                      style={[
                        styles.voiceSampleRow,
                        selectedVoiceSampleId === vs.id && { borderColor: C.tint, borderWidth: 2 },
                      ]}
                      onPress={() => {
                        setSelectedVoiceSampleId(vs.id);
                      }}
                    >
                      <View style={styles.voiceSampleInfo}>
                        <Ionicons name="recording" size={18} color={selectedVoiceSampleId === vs.id ? C.tint : C.textSecondary} />
                        <View>
                          <Text style={styles.voiceSampleName}>{vs.name}</Text>
                          <Text style={styles.voiceSampleMeta}>{Math.round(vs.duration)}s recorded</Text>
                        </View>
                      </View>
                      {selectedVoiceSampleId === vs.id && (
                        <Ionicons name="checkmark-circle" size={20} color={C.tint} />
                      )}
                    </Pressable>
                  ))}
                </>
              )}
            </View>

            <Pressable
              style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
              onPress={handleAddNumber}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#000" />
              ) : (
                <>
                  <Ionicons name="add-circle" size={20} color="#000" />
                  <Text style={styles.saveBtnLabel}>Add Number & Connect Agent ({DAILY_CREDIT_COST} credits/day)</Text>
                </>
              )}
            </Pressable>
          </>
        )}
      </ScrollView>

      <Modal visible={showAgentModal} transparent animationType="fade" onRequestClose={() => setShowAgentModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Agent Test</Text>
              <Pressable onPress={() => setShowAgentModal(false)}>
                <Ionicons name="close" size={24} color={C.textSecondary} />
              </Pressable>
            </View>
            {selectedNumber && (
              <View style={styles.modalMeta}>
                <Text style={styles.modalMetaText}>{selectedNumber.agentName} - {selectedNumber.phoneNumber}</Text>
              </View>
            )}
            <View style={styles.testBubbleUser}>
              <Text style={styles.testBubbleText}>Hello, I'm calling about your services. Can you help me?</Text>
            </View>
            {testing ? (
              <View style={styles.testLoading}>
                <ActivityIndicator color={C.tint} />
                <Text style={styles.testLoadingText}>Agent is thinking...</Text>
              </View>
            ) : testResponse ? (
              <View style={styles.testBubbleAgent}>
                <Text style={styles.testBubbleText}>{testResponse}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function GuideStep({ num, text }: { num: number; text: string }) {
  return (
    <View style={styles.guideStep}>
      <View style={styles.guideStepNum}>
        <Text style={styles.guideStepNumText}>{num}</Text>
      </View>
      <Text style={styles.guideStepText}>{text}</Text>
    </View>
  );
}

function CredentialRow({ label, example }: { label: string; example: string }) {
  return (
    <View style={styles.credRow}>
      <Text style={styles.credLabel}>{label}:</Text>
      <Text style={styles.credValue}>{example}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  headerTitle: { fontSize: 28, fontWeight: "800" as const, color: C.text, fontFamily: "Inter_700Bold" },
  headerSub: { fontSize: 13, color: C.textSecondary, marginTop: 2 },

  tabRow: { flexDirection: "row", paddingHorizontal: 16, gap: 6, marginBottom: 8 },
  tabBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
  },
  tabBtnActive: { borderColor: C.tint, backgroundColor: C.tint + "15" },
  tabLabel: { fontSize: 12, fontWeight: "600" as const, color: C.textTertiary },
  tabLabelActive: { color: C.tint },

  content: { flex: 1, paddingHorizontal: 16 },

  pricingBanner: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: C.tint + "12", borderRadius: 14, padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: C.tint + "30",
  },
  pricingLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  pricingTitle: { fontSize: 15, fontWeight: "700" as const, color: C.text },
  pricingDesc: { fontSize: 11, color: C.textSecondary, marginTop: 1 },
  pricingBadge: {
    backgroundColor: C.tint, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5,
  },
  pricingBadgeText: { fontSize: 12, fontWeight: "700" as const, color: "#000" },

  webhookCard: {
    backgroundColor: C.card, borderRadius: 16, padding: 16, marginBottom: 16,
    borderWidth: 1, borderColor: C.tint + "30",
  },
  webhookHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  webhookTitle: { fontSize: 15, fontWeight: "700" as const, color: C.text },
  webhookDesc: { fontSize: 12, color: C.textSecondary, marginBottom: 10, lineHeight: 18 },
  webhookUrlBox: {
    backgroundColor: C.backgroundSecondary, borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: C.borderLight, marginBottom: 10,
  },
  webhookUrl: { fontSize: 11, color: C.tint, fontFamily: Platform.OS === "web" ? "monospace" : undefined },
  webhookInfoRow: { flexDirection: "row", gap: 8, marginBottom: 4 },
  webhookInfoLabel: { fontSize: 12, color: C.textTertiary, fontWeight: "600" as const },
  webhookInfoValue: { fontSize: 12, color: C.textSecondary },

  emptyState: { alignItems: "center", paddingTop: 40, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: "700" as const, color: C.text },
  emptyDesc: { fontSize: 13, color: C.textSecondary, textAlign: "center", maxWidth: 300, lineHeight: 20 },
  addFirstBtn: {
    flexDirection: "row", alignItems: "center", gap: 8, marginTop: 16,
    paddingHorizontal: 24, paddingVertical: 14, borderRadius: 14,
    backgroundColor: C.tint,
  },
  addFirstLabel: { fontSize: 15, fontWeight: "700" as const, color: "#000" },

  numberCard: {
    backgroundColor: C.card, borderRadius: 16, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: C.borderLight,
  },
  numberHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  numberInfo: { flex: 1 },
  numberPhone: { fontSize: 18, fontWeight: "800" as const, color: C.text },
  numberName: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  statusDot: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  statusLabel: { fontSize: 11, fontWeight: "700" as const, color: "#fff" },
  numberMeta: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 8 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { fontSize: 12, color: C.textTertiary },

  billingRow: {
    flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 8,
    paddingVertical: 8, borderTopWidth: 1, borderTopColor: C.border,
  },
  billingItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  billingText: { fontSize: 12, color: C.textSecondary },

  numberSip: { paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border, marginBottom: 10 },
  sipLabel: { fontSize: 11, color: C.textTertiary },
  numberActions: { flexDirection: "row", gap: 12 },
  actionBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10,
    backgroundColor: C.backgroundSecondary,
  },
  actionLabel: { fontSize: 12, fontWeight: "600" as const },

  costBanner: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: C.warning + "18", borderRadius: 14, padding: 14, marginBottom: 16,
    borderWidth: 1, borderColor: C.warning + "40",
  },
  costBannerTitle: { fontSize: 14, fontWeight: "700" as const, color: C.text },
  costBannerDesc: { fontSize: 11, color: C.textSecondary, marginTop: 2 },

  section: { marginBottom: 20 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  sectionTitle: { fontSize: 16, fontWeight: "700" as const, color: C.text },
  fieldHint: { fontSize: 12, color: C.textTertiary, marginBottom: 12, lineHeight: 18 },
  fieldLabel: { fontSize: 13, fontWeight: "600" as const, color: C.textSecondary, marginBottom: 6, marginTop: 12 },
  input: {
    backgroundColor: C.inputBackground, borderWidth: 1, borderColor: C.inputBorder,
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
    color: C.text, fontSize: 15, fontFamily: "Inter_400Regular",
  },
  inputMultiline: { minHeight: 80, textAlignVertical: "top" as const, paddingTop: 14 },

  personalityRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  personalityCard: {
    flex: 1, minWidth: 95, backgroundColor: C.backgroundSecondary, borderRadius: 12,
    padding: 12, borderWidth: 1, borderColor: C.border, position: "relative" as const,
  },
  personalityDot: { width: 12, height: 12, borderRadius: 6, marginBottom: 6 },
  personalityName: { fontSize: 12, fontWeight: "700" as const, color: C.text, marginBottom: 2 },
  personalityDesc: { fontSize: 10, color: C.textTertiary },
  personalityCheck: { position: "absolute" as const, top: 8, right: 8 },

  voiceGrid: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  voiceCard: {
    width: "30%" as any, minWidth: 90, backgroundColor: C.backgroundSecondary, borderRadius: 12,
    padding: 10, borderWidth: 1, borderColor: C.border, position: "relative" as const,
    alignItems: "center" as const,
  },
  voiceDot: { width: 10, height: 10, borderRadius: 5, marginBottom: 4 },
  voiceName: { fontSize: 12, fontWeight: "700" as const, color: C.text, marginBottom: 1 },
  voiceDesc: { fontSize: 9, color: C.textTertiary },
  voiceSampleRow: {
    flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const,
    backgroundColor: C.backgroundSecondary, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: C.border, marginBottom: 8,
  },
  voiceSampleInfo: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10 },
  voiceSampleName: { fontSize: 14, fontWeight: "600" as const, color: C.text },
  voiceSampleMeta: { fontSize: 11, color: C.textTertiary },

  saveBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    backgroundColor: C.tint, borderRadius: 14, paddingVertical: 16, marginTop: 8, marginBottom: 20,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnLabel: { fontSize: 15, fontWeight: "700" as const, color: "#000" },

  guestBlock: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 40 },
  guestTitle: { fontSize: 22, fontWeight: "700" as const, color: C.text },
  guestDesc: { fontSize: 14, color: C.textSecondary, textAlign: "center" },

  guideIntro: {
    backgroundColor: C.tint + "10", borderRadius: 16, padding: 20, marginBottom: 16,
    borderWidth: 1, borderColor: C.tint + "25", alignItems: "center", gap: 8,
  },
  guideIntroTitle: { fontSize: 17, fontWeight: "800" as const, color: C.text, textAlign: "center" },
  guideIntroDesc: { fontSize: 13, color: C.textSecondary, textAlign: "center", lineHeight: 20 },

  pricingCard: {
    backgroundColor: C.card, borderRadius: 16, padding: 18, marginBottom: 16,
    borderWidth: 1, borderColor: C.tint + "30",
  },
  pricingCardTitle: { fontSize: 16, fontWeight: "700" as const, color: C.text, marginBottom: 12 },
  pricingDetail: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  pricingDetailText: { fontSize: 13, color: C.textSecondary, flex: 1 },

  guideSection: {
    backgroundColor: C.card, borderRadius: 16, padding: 18, marginBottom: 14,
    borderWidth: 1, borderColor: C.borderLight,
  },
  guideSectionTitle: { fontSize: 15, fontWeight: "700" as const, color: C.tint, marginBottom: 10 },
  guideText: { fontSize: 13, color: C.textSecondary, lineHeight: 20, marginBottom: 12 },
  guideHint: { fontSize: 11, color: C.textTertiary, lineHeight: 17, marginTop: 6, fontStyle: "italic" as const },

  webhookGuide: { gap: 8 },
  webhookGuideLabel: { fontSize: 13, fontWeight: "600" as const, color: C.text, marginBottom: 4 },

  guideStep: { flexDirection: "row", gap: 10, alignItems: "flex-start", marginBottom: 4 },
  guideStepNum: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: C.tint + "20",
    alignItems: "center", justifyContent: "center",
  },
  guideStepNumText: { fontSize: 12, fontWeight: "700" as const, color: C.tint },
  guideStepText: { flex: 1, fontSize: 13, color: C.textSecondary, lineHeight: 20 },

  credentialBox: {
    backgroundColor: C.backgroundSecondary, borderRadius: 12, padding: 14, gap: 8,
    borderWidth: 1, borderColor: C.border,
  },
  credRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  credLabel: { fontSize: 12, fontWeight: "600" as const, color: C.text },
  credValue: { fontSize: 12, color: C.textTertiary, fontFamily: Platform.OS === "web" ? "monospace" : undefined },

  bodyParamsCard: {
    backgroundColor: C.backgroundSecondary, borderRadius: 14, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: C.border,
  },
  bodyParamsTitle: { fontSize: 14, fontWeight: "700" as const, color: C.text, marginBottom: 6 },
  bodyParamsDesc: { fontSize: 12, color: C.textTertiary, marginBottom: 12, lineHeight: 18 },
  paramRow: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  paramKey: {
    fontSize: 13, fontWeight: "700" as const, color: C.tint, minWidth: 70,
    fontFamily: Platform.OS === "web" ? "monospace" : undefined,
  },
  paramEquals: { fontSize: 13, color: C.textTertiary },
  paramValue: {
    fontSize: 13, color: C.warning, flex: 1,
    fontFamily: Platform.OS === "web" ? "monospace" : undefined,
  },
  paramHint: { fontSize: 10, color: C.textTertiary },

  fullUrlCard: { marginTop: 4 },
  fullUrlLabel: { fontSize: 12, fontWeight: "600" as const, color: C.text, marginBottom: 6 },

  faqItem: { marginBottom: 14 },
  faqQ: { fontSize: 13, fontWeight: "700" as const, color: C.text, marginBottom: 4 },
  faqA: { fontSize: 12, color: C.textSecondary, lineHeight: 18 },

  guideStartBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    backgroundColor: C.tint, borderRadius: 14, paddingVertical: 16, marginBottom: 20,
  },
  guideStartLabel: { fontSize: 16, fontWeight: "700" as const, color: "#000" },

  modalOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center", justifyContent: "center", padding: 24,
  },
  modalCard: {
    backgroundColor: C.card, borderRadius: 20, padding: 20,
    width: "100%", maxWidth: 400, maxHeight: "80%",
  },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  modalTitle: { fontSize: 18, fontWeight: "700" as const, color: C.text },
  modalMeta: { marginBottom: 16 },
  modalMetaText: { fontSize: 12, color: C.textSecondary },
  testBubbleUser: {
    alignSelf: "flex-end", backgroundColor: C.tint, borderRadius: 16,
    borderBottomRightRadius: 4, padding: 12, maxWidth: "80%", marginBottom: 12,
  },
  testBubbleAgent: {
    alignSelf: "flex-start", backgroundColor: C.backgroundSecondary, borderRadius: 16,
    borderBottomLeftRadius: 4, padding: 12, maxWidth: "85%",
  },
  testBubbleText: { fontSize: 14, color: C.text, lineHeight: 20 },
  testLoading: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12 },
  testLoadingText: { fontSize: 13, color: C.textSecondary },
});
