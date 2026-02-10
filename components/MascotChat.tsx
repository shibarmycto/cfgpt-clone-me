import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Animated,
  Dimensions,
  FlatList,
  Image,
  Platform,
  KeyboardAvoidingView,
  Keyboard,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getApiUrl } from "@/lib/query-client";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Colors from "@/constants/colors";

const C = Colors.light;

const MASCOT_IMG = require("@/assets/images/mascot.png");
const STORAGE_KEY = "cfgpt_mascot_chat";
const PERSONALITY_KEY = "cfgpt_mascot_personality";
const MAX_HISTORY = 30;

type PersonalityId = "urban" | "trader" | "eliza";

interface PersonalityConfig {
  id: PersonalityId;
  name: string;
  tagline: string;
  description: string;
  color: string;
  icon: string;
  greeting: string;
}

const PERSONALITIES: PersonalityConfig[] = [
  {
    id: "urban",
    name: "CF Urban",
    tagline: "your crypto companion",
    description: "Streetwise, laid-back, crypto & football banter",
    color: "#00E676",
    icon: "flash",
    greeting: "yo, i'm CF Urban!\nyour crypto companion from CFGPT\nask me anything - crypto, football, gossip\ni'm free to chat 24/7 fam",
  },
  {
    id: "trader",
    name: "CF Trader",
    tagline: "your elite market analyst",
    description: "Posh London trader, witty comedian, luxury vibes",
    color: "#FFD700",
    icon: "trending-up",
    greeting: "Welcome, old sport!\nI'm CF Trader, your market companion\nLet's discuss crypto, markets & the finer things\nAt your service, naturally",
  },
  {
    id: "eliza",
    name: "CF Eliza",
    tagline: "your spiritual bestie",
    description: "Positivity, affirmations, spiritual vibes & gossip",
    color: "#FF69B4",
    icon: "heart",
    greeting: "hey gorgeous!\ni'm CF Eliza, your spiritual bestie\nlet's chat love, positivity, soaps & gossip\nyou're glowing today, babe",
  },
];

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

function generateId(): string {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

function PersonalityCard({
  p,
  isSelected,
  onSelect,
}: {
  p: PersonalityConfig;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <Pressable
      onPress={onSelect}
      style={({ pressed }) => [
        pStyles.card,
        isSelected && { borderColor: p.color, borderWidth: 2 },
        pressed && { opacity: 0.85 },
      ]}
    >
      <View style={[pStyles.iconCircle, { backgroundColor: p.color + "22" }]}>
        <Ionicons name={p.icon as any} size={22} color={p.color} />
      </View>
      <Text style={pStyles.name}>{p.name}</Text>
      <Text style={pStyles.tagline}>{p.tagline}</Text>
      <Text style={pStyles.desc} numberOfLines={2}>{p.description}</Text>
      {isSelected && (
        <View style={[pStyles.selectedBadge, { backgroundColor: p.color }]}>
          <Ionicons name="checkmark" size={12} color="#000" />
        </View>
      )}
    </Pressable>
  );
}

export default function MascotChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [showSelector, setShowSelector] = useState(false);
  const [personality, setPersonality] = useState<PersonalityId>("urban");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState("");

  const bounceAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const flatListRef = useRef<FlatList>(null);

  const currentP = PERSONALITIES.find((p) => p.id === personality) || PERSONALITIES[0];

  useEffect(() => {
    const isWeb = Platform.OS === "web";
    Animated.loop(
      Animated.sequence([
        Animated.timing(bounceAnim, {
          toValue: -12,
          duration: 1500,
          useNativeDriver: !isWeb,
        }),
        Animated.timing(bounceAnim, {
          toValue: 0,
          duration: 1500,
          useNativeDriver: !isWeb,
        }),
      ])
    ).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.08,
          duration: 2000,
          useNativeDriver: !isWeb,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: !isWeb,
        }),
      ])
    ).start();
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(PERSONALITY_KEY).then((data) => {
      if (data && ["urban", "trader", "eliza"].includes(data)) {
        setPersonality(data as PersonalityId);
      }
    });
    AsyncStorage.getItem(STORAGE_KEY).then((data) => {
      if (data) {
        try {
          const parsed = JSON.parse(data) as ChatMessage[];
          setMessages(parsed.slice(-MAX_HISTORY));
        } catch {}
      }
    });
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-MAX_HISTORY)));
    }
  }, [messages]);

  const selectPersonality = useCallback((id: PersonalityId) => {
    setPersonality(id);
    AsyncStorage.setItem(PERSONALITY_KEY, id);
    setMessages([]);
    AsyncStorage.removeItem(STORAGE_KEY);
    setShowSelector(false);
  }, []);

  const toggleChat = useCallback(() => {
    const isWeb = Platform.OS === "web";
    if (isOpen) {
      Animated.timing(scaleAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: !isWeb,
      }).start(() => {
        setIsOpen(false);
        setShowSelector(false);
      });
    } else {
      setIsOpen(true);
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 6,
        tension: 100,
        useNativeDriver: !isWeb,
      }).start();
    }
  }, [isOpen, scaleAnim]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    const userMsg: ChatMessage = {
      id: generateId(),
      role: "user",
      content: text,
      timestamp: Date.now(),
    };

    const currentMessages = [...messages, userMsg];
    setMessages(currentMessages);
    setInput("");
    setIsStreaming(true);
    setStreamContent("");

    Keyboard.dismiss();

    try {
      const apiMessages = currentMessages.slice(-10).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const baseUrl = getApiUrl();
      const url = new URL("/api/mascot-chat", baseUrl);
      const fetchUrl = url.toString();
      const res = await globalThis.fetch(fetchUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: apiMessages,
          userId: "mascot_user_" + (await AsyncStorage.getItem("cfgpt_user_id") || "anon"),
          personality,
        }),
      });

      if (!res.ok) {
        throw new Error("API error: " + res.status);
      }

      const data = await res.json();

      if (data.content) {
        const assistantMsg: ChatMessage = {
          id: generateId(),
          role: "assistant",
          content: data.content,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
      }
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: generateId(),
        role: "assistant",
        content: personality === "trader"
          ? "Frightfully sorry old sport, a minor technical hiccup. Do try again in a moment."
          : personality === "eliza"
          ? "oh no babe, something went wrong! try again in a sec, sending you good vibes"
          : "yo my bad fam, something glitched out. hit me again in a sec",
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsStreaming(false);
      setStreamContent("");
    }
  }, [input, isStreaming, messages, personality]);

  const clearChat = useCallback(() => {
    setMessages([]);
    AsyncStorage.removeItem(STORAGE_KEY);
  }, []);

  const renderMessage = useCallback(({ item }: { item: ChatMessage }) => {
    const isUser = item.role === "user";
    return (
      <View
        style={[
          styles.msgRow,
          isUser ? styles.msgRowUser : styles.msgRowBot,
        ]}
      >
        {!isUser && (
          <View style={[styles.msgAvatarWrap, { borderColor: currentP.color }]}>
            <Image source={MASCOT_IMG} style={styles.msgAvatar} />
          </View>
        )}
        <View
          style={[
            styles.msgBubble,
            isUser ? styles.msgBubbleUser : styles.msgBubbleBot,
          ]}
        >
          <Text
            style={[
              styles.msgText,
              isUser ? styles.msgTextUser : styles.msgTextBot,
            ]}
          >
            {item.content}
          </Text>
        </View>
      </View>
    );
  }, [currentP.color]);

  const { width: screenWidth } = Dimensions.get("window");
  const chatWidth = Math.min(screenWidth - 32, 380);

  return (
    <View style={[styles.container, { pointerEvents: "box-none" as const }]}>
      {isOpen && (
        <Animated.View
          style={[
            styles.chatPanel,
            {
              width: chatWidth,
              transform: [{ scale: scaleAnim }],
              opacity: scaleAnim,
            },
          ]}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.chatInner}
            keyboardVerticalOffset={100}
          >
            <View style={[styles.chatHeader, { borderBottomColor: currentP.color + "40" }]}>
              <Pressable onPress={() => setShowSelector(!showSelector)} hitSlop={4}>
                <Image source={MASCOT_IMG} style={[styles.headerAvatar, { borderColor: currentP.color }]} />
              </Pressable>
              <Pressable onPress={() => setShowSelector(!showSelector)} style={styles.headerInfo}>
                <Text style={[styles.headerName, { color: currentP.color }]}>{currentP.name}</Text>
                <View style={styles.onlineRow}>
                  <View style={[styles.onlineDot, { backgroundColor: currentP.color }]} />
                  <Text style={[styles.onlineText, { color: currentP.color }]}>{currentP.tagline}</Text>
                </View>
              </Pressable>
              <View style={styles.headerActions}>
                <Pressable onPress={() => setShowSelector(!showSelector)} hitSlop={8}>
                  <Ionicons name="people" size={18} color={C.textSecondary} />
                </Pressable>
                <Pressable onPress={clearChat} hitSlop={8} style={{ marginLeft: 10 }}>
                  <Ionicons name="trash-outline" size={18} color={C.textSecondary} />
                </Pressable>
                <Pressable onPress={toggleChat} hitSlop={8} style={{ marginLeft: 10 }}>
                  <Ionicons name="close" size={22} color={C.textSecondary} />
                </Pressable>
              </View>
            </View>

            {showSelector ? (
              <ScrollView style={styles.selectorWrap} contentContainerStyle={styles.selectorContent}>
                <Text style={styles.selectorTitle}>Choose your AI assistant</Text>
                <Text style={styles.selectorSub}>Each has a unique personality</Text>
                {PERSONALITIES.map((p) => (
                  <PersonalityCard
                    key={p.id}
                    p={p}
                    isSelected={personality === p.id}
                    onSelect={() => selectPersonality(p.id)}
                  />
                ))}
              </ScrollView>
            ) : (
              <>
                <FlatList
                  ref={flatListRef}
                  data={messages}
                  extraData={`${isStreaming}_${streamContent.length}_${personality}`}
                  renderItem={renderMessage}
                  keyExtractor={(item) => item.id}
                  style={styles.messagesList}
                  contentContainerStyle={styles.messagesContent}
                  onContentSizeChange={() =>
                    flatListRef.current?.scrollToEnd({ animated: true })
                  }
                  onLayout={() =>
                    flatListRef.current?.scrollToEnd({ animated: false })
                  }
                  ListEmptyComponent={
                    <View style={styles.emptyState}>
                      <Image source={MASCOT_IMG} style={[styles.emptyAvatar, { borderColor: currentP.color }]} />
                      <Text style={[styles.emptyTitle, { color: currentP.color }]}>{currentP.name}</Text>
                      <Text style={styles.emptyText}>{currentP.greeting}</Text>
                      <Pressable
                        onPress={() => setShowSelector(true)}
                        style={[styles.switchBtn, { borderColor: currentP.color + "60" }]}
                      >
                        <Ionicons name="people" size={14} color={currentP.color} />
                        <Text style={[styles.switchBtnText, { color: currentP.color }]}>switch personality</Text>
                      </Pressable>
                    </View>
                  }
                  ListFooterComponent={
                    isStreaming && streamContent ? (
                      <View style={[styles.msgRow, styles.msgRowBot]}>
                        <View style={[styles.msgAvatarWrap, { borderColor: currentP.color }]}>
                          <Image source={MASCOT_IMG} style={styles.msgAvatar} />
                        </View>
                        <View style={[styles.msgBubble, styles.msgBubbleBot]}>
                          <Text style={[styles.msgText, styles.msgTextBot]}>
                            {streamContent}
                          </Text>
                        </View>
                      </View>
                    ) : isStreaming ? (
                      <View style={[styles.msgRow, styles.msgRowBot]}>
                        <View style={[styles.msgAvatarWrap, { borderColor: currentP.color }]}>
                          <Image source={MASCOT_IMG} style={styles.msgAvatar} />
                        </View>
                        <View style={[styles.msgBubble, styles.msgBubbleBot]}>
                          <Text style={[styles.msgText, styles.msgTextBot]}>...</Text>
                        </View>
                      </View>
                    ) : null
                  }
                  scrollEnabled={messages.length > 0}
                  keyboardShouldPersistTaps="handled"
                />

                <View style={styles.inputRow}>
                  <TextInput
                    style={styles.input}
                    value={input}
                    onChangeText={setInput}
                    placeholder={`say something to ${currentP.name}...`}
                    placeholderTextColor={C.placeholder}
                    multiline
                    maxLength={500}
                    onSubmitEditing={sendMessage}
                    returnKeyType="send"
                    editable={!isStreaming}
                    testID="mascot-input"
                  />
                  <Pressable
                    onPress={sendMessage}
                    disabled={!input.trim() || isStreaming}
                    testID="mascot-send"
                    style={({ pressed }) => [
                      styles.sendBtn,
                      { backgroundColor: currentP.color },
                      (!input.trim() || isStreaming) && styles.sendBtnDisabled,
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <Ionicons
                      name="send"
                      size={18}
                      color={!input.trim() || isStreaming ? C.textTertiary : "#000"}
                    />
                  </Pressable>
                </View>
              </>
            )}
          </KeyboardAvoidingView>
        </Animated.View>
      )}

      <Pressable
        onPress={toggleChat}
        testID="mascot-button"
        accessibilityLabel="Open CF chat"
        style={({ pressed }) => [
          styles.fabWrap,
          pressed && { opacity: 0.85 },
        ]}
      >
        <Animated.View
          style={[
            styles.fab,
            { borderColor: currentP.color },
            {
              transform: [
                { translateY: bounceAnim },
                { scale: pulseAnim },
              ],
            },
          ]}
        >
          <Image source={MASCOT_IMG} style={styles.fabImage} />
          {!isOpen && (
            <View style={styles.fabBadge}>
              <View style={[styles.fabBadgeDot, { backgroundColor: currentP.color }]} />
            </View>
          )}
        </Animated.View>
      </Pressable>
    </View>
  );
}

const pStyles = StyleSheet.create({
  card: {
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: C.border,
    position: "relative",
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 8,
  },
  name: {
    color: C.text,
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    marginBottom: 2,
  },
  tagline: {
    color: C.textSecondary,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginBottom: 4,
  },
  desc: {
    color: C.textTertiary,
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    lineHeight: 16,
  },
  selectedBadge: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: "center",
    alignItems: "center",
  },
});

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: Platform.OS === "web" ? 100 : 110,
    right: 16,
    zIndex: 9999,
    alignItems: "flex-end",
  },
  fabWrap: {
    alignSelf: "flex-end",
  },
  fab: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: C.card,
    justifyContent: "center",
    alignItems: "center",
    elevation: 10,
    borderWidth: 2,
    borderColor: C.tint,
    overflow: "hidden",
    ...(Platform.OS === "web"
      ? { boxShadow: "0 4px 20px rgba(0,212,170,0.35)" }
      : { shadowColor: C.tint, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12 }),
  } as any,
  fabImage: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  fabBadge: {
    position: "absolute",
    top: 2,
    right: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: C.card,
    justifyContent: "center",
    alignItems: "center",
  },
  fabBadgeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#22C55E",
  },
  chatPanel: {
    position: "absolute",
    bottom: 76,
    right: 0,
    height: 460,
    backgroundColor: C.backgroundSecondary,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.borderLight,
    overflow: "hidden",
    elevation: 20,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 8px 40px rgba(0,0,0,0.5)" }
      : { shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.5, shadowRadius: 24 }),
  } as any,
  chatInner: {
    flex: 1,
  },
  chatHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: C.card,
  },
  headerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: C.tint,
  },
  headerInfo: {
    flex: 1,
    marginLeft: 10,
  },
  headerName: {
    color: C.text,
    fontSize: 15,
    fontFamily: "Inter_700Bold",
  },
  onlineRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 1,
  },
  onlineDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#22C55E",
    marginRight: 5,
  },
  onlineText: {
    color: "#22C55E",
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
  },
  selectorWrap: {
    flex: 1,
  },
  selectorContent: {
    padding: 16,
  },
  selectorTitle: {
    color: C.text,
    fontSize: 17,
    fontFamily: "Inter_700Bold",
    marginBottom: 4,
  },
  selectorSub: {
    color: C.textSecondary,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginBottom: 16,
  },
  switchBtn: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    gap: 6,
  },
  switchBtnText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  messagesList: {
    flex: 1,
  },
  messagesContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexGrow: 1,
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 30,
    paddingHorizontal: 20,
  },
  emptyAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: C.tint,
  },
  emptyTitle: {
    color: C.text,
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    marginBottom: 6,
  },
  emptyText: {
    color: C.textSecondary,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
  },
  msgRow: {
    flexDirection: "row",
    marginVertical: 3,
    alignItems: "flex-end",
  },
  msgRowUser: {
    justifyContent: "flex-end",
  },
  msgRowBot: {
    justifyContent: "flex-start",
  },
  msgAvatarWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    overflow: "hidden",
    marginRight: 6,
  },
  msgAvatar: {
    width: 25,
    height: 25,
    borderRadius: 13,
  },
  msgBubble: {
    maxWidth: "75%",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
  },
  msgBubbleUser: {
    backgroundColor: C.tint,
    borderBottomRightRadius: 4,
  },
  msgBubbleBot: {
    backgroundColor: C.card,
    borderBottomLeftRadius: 4,
  },
  msgText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  msgTextUser: {
    color: "#0A0E1A",
  },
  msgTextBot: {
    color: C.text,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: C.border,
    backgroundColor: C.card,
  },
  input: {
    flex: 1,
    color: C.text,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    backgroundColor: C.inputBackground,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxHeight: 80,
    borderWidth: 1,
    borderColor: C.inputBorder,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.tint,
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
  },
  sendBtnDisabled: {
    backgroundColor: C.card,
  },
});
