import React, { useState, useEffect } from "react";
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  Pressable,
  ActivityIndicator,
  Platform,
  Alert,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import Colors from "@/constants/colors";
import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";

const C = Colors.light;

export default function AuthScreen() {
  const insets = useSafeAreaInsets();
  const { user, isGuest, isLoading, login, register } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (!isLoading && user && !isGuest) {
      router.replace("/(tabs)");
    }
  }, [user, isLoading, isGuest]);

  const handleSubmit = async () => {
    setError("");
    if (!email.trim() || !password.trim()) {
      setError("Please fill in all fields");
      return;
    }
    if (!isLogin && !name.trim()) {
      setError("Please enter your name");
      return;
    }
    setLoading(true);
    try {
      let err: string | null;
      if (isLogin) {
        err = await login(email.trim(), password);
      } else {
        err = await register(email.trim(), password, name.trim());
      }
      if (err) {
        setError(err);
      } else {
        router.replace("/(tabs)");
      }
    } catch {
      setError("Something went wrong");
    }
    setLoading(false);
  };

  const topInset = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View style={styles.container}>
      <KeyboardAwareScrollViewCompat
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: topInset + 40, paddingBottom: insets.bottom + 40 },
        ]}
        bottomOffset={20}
      >
        <Pressable
          onPress={() => router.back()}
          style={styles.backBtn}
        >
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </Pressable>

        <View style={styles.logoContainer}>
          <LinearGradient
            colors={[C.tint, C.accent]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.logoGradient}
          >
            <Ionicons name="mic" size={36} color="#FFF" />
          </LinearGradient>
          <Text style={styles.appTitle}>CFGPT Clone Me</Text>
          <Text style={styles.appSubtitle}>
            Sign in to unlock all features
          </Text>
        </View>

        <View style={styles.benefitsCard}>
          <Text style={styles.benefitsTitle}>What you get with an account:</Text>
          {[
            "Unlimited AI chat messages",
            "Image & video generation",
            "Voice cloning",
            "AI receptionist & SIP config",
            "5 free generation credits",
          ].map((benefit, i) => (
            <View key={i} style={styles.benefitRow}>
              <Ionicons name="checkmark-circle" size={18} color={C.tint} />
              <Text style={styles.benefitText}>{benefit}</Text>
            </View>
          ))}
        </View>

        <View style={styles.formCard}>
          <View style={styles.tabRow}>
            <Pressable
              onPress={() => { setIsLogin(true); setError(""); }}
              style={[styles.tab, isLogin && styles.tabActive]}
            >
              <Text style={[styles.tabText, isLogin && styles.tabTextActive]}>
                Sign In
              </Text>
            </Pressable>
            <Pressable
              onPress={() => { setIsLogin(false); setError(""); }}
              style={[styles.tab, !isLogin && styles.tabActive]}
            >
              <Text style={[styles.tabText, !isLogin && styles.tabTextActive]}>
                Sign Up
              </Text>
            </Pressable>
          </View>

          {!isLogin && (
            <View style={styles.inputContainer}>
              <Ionicons
                name="person-outline"
                size={20}
                color={C.textSecondary}
                style={styles.inputIcon}
              />
              <TextInput
                style={styles.input}
                placeholder="Full Name"
                placeholderTextColor={C.placeholder}
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
              />
            </View>
          )}

          <View style={styles.inputContainer}>
            <Ionicons
              name="mail-outline"
              size={20}
              color={C.textSecondary}
              style={styles.inputIcon}
            />
            <TextInput
              style={styles.input}
              placeholder="Email Address"
              placeholderTextColor={C.placeholder}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>

          <View style={styles.inputContainer}>
            <Ionicons
              name="lock-closed-outline"
              size={20}
              color={C.textSecondary}
              style={styles.inputIcon}
            />
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder="Password"
              placeholderTextColor={C.placeholder}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
            />
            <Pressable onPress={() => setShowPassword(!showPassword)}>
              <Ionicons
                name={showPassword ? "eye-off-outline" : "eye-outline"}
                size={20}
                color={C.textSecondary}
              />
            </Pressable>
          </View>

          {!!error && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color={C.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <Pressable
            onPress={handleSubmit}
            disabled={loading}
            style={({ pressed }) => [
              styles.submitBtn,
              { opacity: pressed || loading ? 0.8 : 1 },
            ]}
          >
            <LinearGradient
              colors={[C.tint, C.accent]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.submitGradient}
            >
              {loading ? (
                <ActivityIndicator color="#FFF" size="small" />
              ) : (
                <Text style={styles.submitText}>
                  {isLogin ? "Sign In" : "Create Account"}
                </Text>
              )}
            </LinearGradient>
          </Pressable>
        </View>

        <Text style={styles.footerText}>
          Powered by CFGPT AI Technology
        </Text>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
  },
  scrollContent: {
    paddingHorizontal: 24,
    flexGrow: 1,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.backgroundSecondary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  logoContainer: {
    alignItems: "center",
    marginBottom: 24,
  },
  logoGradient: {
    width: 80,
    height: 80,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  appTitle: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    color: C.text,
    marginBottom: 4,
  },
  appSubtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: C.textSecondary,
  },
  benefitsCard: {
    backgroundColor: C.backgroundSecondary,
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    gap: 10,
  },
  benefitsTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    color: C.text,
    marginBottom: 4,
  },
  benefitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  benefitText: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: C.textSecondary,
  },
  formCard: {
    backgroundColor: C.backgroundSecondary,
    borderRadius: 20,
    padding: 24,
    gap: 16,
  },
  tabRow: {
    flexDirection: "row",
    backgroundColor: C.card,
    borderRadius: 12,
    padding: 4,
    marginBottom: 8,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 10,
  },
  tabActive: {
    backgroundColor: C.tint,
  },
  tabText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: C.textSecondary,
  },
  tabTextActive: {
    color: "#FFF",
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.inputBackground,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.inputBorder,
    paddingHorizontal: 14,
    height: 52,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    color: C.text,
    fontFamily: "Inter_400Regular",
    fontSize: 15,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(239,68,68,0.1)",
    padding: 12,
    borderRadius: 10,
  },
  errorText: {
    color: C.danger,
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    flex: 1,
  },
  submitBtn: {
    borderRadius: 12,
    overflow: "hidden",
    marginTop: 4,
  },
  submitGradient: {
    paddingVertical: 16,
    alignItems: "center",
    borderRadius: 12,
  },
  submitText: {
    color: "#FFF",
    fontFamily: "Inter_700Bold",
    fontSize: 16,
  },
  footerText: {
    textAlign: "center",
    color: C.textTertiary,
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    marginTop: 32,
  },
});
