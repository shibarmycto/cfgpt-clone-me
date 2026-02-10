import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
  Platform,
  ActivityIndicator,
  Linking,
  Modal,
  TextInput,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import { router } from "expo-router";
import Colors from "@/constants/colors";

interface CreditPackage {
  id: string;
  name: string;
  price: number;
  currency: string;
  credits: number;
  description: string;
}

const C = Colors.light;

const ADMOB_APP_ID = "ca-app-pub-4631519337168518~1862347473";
const ADMOB_REWARDED_UNIT = "ca-app-pub-4631519337168518/8671288669";
const OFFER_LINK_URL = "https://otieu.com/4/10586330";
const MAX_LINK_CLICKS_PER_DAY = 5;

function buildAdMobPlayerHtml(): string {
  const html = [
    '<!DOCTYPE html><html><head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">',
    '<style>',
    '*{margin:0;padding:0;box-sizing:border-box}',
    'body{background:#0A0E1A;display:flex;align-items:center;justify-content:center;min-height:100vh;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,sans-serif}',
    '.ad-wrap{width:100%;max-width:480px;text-align:center;padding:20px}',
    '#ad-area{width:100%;min-height:270px;background:#161b22;border-radius:12px;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative}',
    '.status{text-align:center;padding:12px;color:#94A3B8;font-size:14px}',
    '.status.ok{color:#00D4AA}',
    '.status.err{color:#EF4444}',
    '.btn{display:inline-flex;align-items:center;gap:10px;padding:16px 32px;background:linear-gradient(135deg,#00D4AA,#00B4D8);color:#fff;font-size:16px;font-weight:700;border:none;border-radius:12px;cursor:pointer;margin-top:12px}',
    '.btn:disabled{opacity:0.5;cursor:not-allowed}',
    '.timer{position:absolute;top:12px;right:12px;background:rgba(0,0,0,0.7);color:#fff;padding:6px 12px;border-radius:20px;font-size:13px;font-weight:600}',
    '.label{position:absolute;top:12px;left:12px;background:rgba(0,212,170,0.2);color:#00D4AA;padding:4px 10px;border-radius:6px;font-size:11px;font-weight:600;letter-spacing:0.5px}',
    '</style>',
    '</head><body>',
    '<div class="ad-wrap">',
    '<div id="ad-area">',
    '<div style="color:#8b949e;text-align:center;padding:40px">',
    '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#00D4AA" stroke-width="2"><polygon points="5 3 19 12 5 21"/></svg>',
    '<p style="margin-top:16px;font-size:15px">Tap the button to watch a rewarded advert</p>',
    '</div></div>',
    '<div id="status" class="status ok">Watch a short advert to earn 1 free credit</div>',
    '<button id="btn" class="btn" onclick="startAd()">Watch Advert</button>',
    '</div>',
    '<script src="https://imasdk.googleapis.com/js/sdkloader/ima3.js"><\/script>',
    '<script>',
    '(function(){',
    'var st=document.getElementById("status"),btn=document.getElementById("btn"),area=document.getElementById("ad-area");',
    'var done=false,t0=0,ti=null,MIN=5;',
    'function fin(){if(done)return;done=true;st.textContent="Advert complete! Earning credit...";st.className="status ok";btn.style.display="none";',
    'window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:"AD_COMPLETE"}));',
    'window.parent&&window.parent.postMessage({type:"AD_COMPLETE"},"*");}',
    'function timer(){t0=Date.now();var te=document.createElement("div");te.className="timer";te.id="tmr";area.appendChild(te);',
    'var le=document.createElement("div");le.className="label";le.textContent="REWARDED AD";area.appendChild(le);',
    'ti=setInterval(function(){var s=Math.floor((Date.now()-t0)/1000),r=Math.max(0,MIN-s);',
    'te.textContent=r>0?r+"s remaining":"Complete!";',
    'if(r<=0){clearInterval(ti);setTimeout(fin,1000);}},1000);}',
    'window.startAd=function(){done=false;btn.disabled=true;st.textContent="Loading advert...";st.className="status";',
    'try{var c=document.createElement("div");c.style.cssText="width:100%;height:270px;position:relative";area.innerHTML="";area.appendChild(c);',
    'var dc=new google.ima.AdDisplayContainer(c);dc.initialize();',
    'var al=new google.ima.AdsLoader(dc);',
    'al.addEventListener(google.ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED,function(e){',
    'var am=e.getAdsManager(c,{autoAlign:true});',
    'am.addEventListener(google.ima.AdEvent.Type.STARTED,function(){st.textContent="Watching advert...";timer();});',
    'am.addEventListener(google.ima.AdEvent.Type.COMPLETE,function(){fin();});',
    'am.addEventListener(google.ima.AdEvent.Type.ALL_ADS_COMPLETED,function(){fin();});',
    'am.addEventListener(google.ima.AdErrorEvent.Type.AD_ERROR,function(){st.textContent="Watching sponsored content...";timer();});',
    'try{am.init(c.offsetWidth,270,google.ima.ViewMode.NORMAL);am.start();}catch(x){timer();st.textContent="Watching content...";}});',
    'al.addEventListener(google.ima.AdErrorEvent.Type.AD_ERROR,function(){',
    'area.innerHTML=\'<div style="padding:40px;text-align:center;color:#c9d1d9"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#00D4AA" stroke-width="2"><polygon points="5 3 19 12 5 21"/></svg><p style="margin-top:16px">Sponsored content</p></div>\';',
    'st.textContent="Watching sponsored content...";timer();});',
    'var rq=new google.ima.AdsRequest();',
    'rq.adTagUrl="https://googleads.g.doubleclick.net/pagead/ads?ad_type=video_text_image&client=' + ADMOB_APP_ID + '&slotname=' + ADMOB_REWARDED_UNIT + '&description_url="+encodeURIComponent(window.location.href);',
    'rq.linearAdSlotWidth=c.offsetWidth;rq.linearAdSlotHeight=270;',
    'rq.nonLinearAdSlotWidth=c.offsetWidth;rq.nonLinearAdSlotHeight=150;',
    'al.requestAds(rq);',
    '}catch(e){area.innerHTML=\'<div style="padding:40px;text-align:center;color:#c9d1d9"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#00D4AA" stroke-width="2"><polygon points="5 3 19 12 5 21"/></svg><p style="margin-top:16px">Sponsored content</p></div>\';',
    'st.textContent="Watching sponsored content...";timer();}};',
    '})();',
    '<\/script></body></html>',
  ].join('\n');
  return html;
}

export default function EarnCreditsTab() {
  const insets = useSafeAreaInsets();
  const { user, isGuest, updateUser } = useAuth();

  const [adsRemaining, setAdsRemaining] = useState(10);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [showPlayer, setShowPlayer] = useState(false);
  const [loading, setLoading] = useState(false);
  const [awarding, setAwarding] = useState(false);
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [linkClicksRemaining, setLinkClicksRemaining] = useState(MAX_LINK_CLICKS_PER_DAY);
  const [linkCooldown, setLinkCooldown] = useState(0);
  const [claimingLink, setClaimingLink] = useState(false);
  const [showSupportModal, setShowSupportModal] = useState(false);
  const [supportSubject, setSupportSubject] = useState("");
  const [supportMessage, setSupportMessage] = useState("");
  const [sendingSupport, setSendingSupport] = useState(false);
  const linkCooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  useEffect(() => {
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
      if (linkCooldownRef.current) clearInterval(linkCooldownRef.current);
    };
  }, []);

  useEffect(() => {
    fetchPackages();
  }, []);

  useEffect(() => {
    if (user && !isGuest) {
      fetchAdStatus();
      fetchLinkStatus();
    }
  }, [user?.id]);

  async function fetchPackages() {
    try {
      const res = await apiRequest("GET", "/api/paypal/packages");
      const data = await res.json();
      setPackages(data);
    } catch {}
  }

  async function fetchLinkStatus() {
    if (!user) return;
    try {
      const res = await apiRequest("GET", `/api/earn/link-status?userId=${user.id}`);
      const data = await res.json();
      setLinkClicksRemaining(data.remaining);
      if (data.cooldownMs > 0) {
        startLinkCooldown(data.cooldownMs);
      }
    } catch {}
  }

  function startLinkCooldown(ms: number) {
    setLinkCooldown(Math.ceil(ms / 1000));
    if (linkCooldownRef.current) clearInterval(linkCooldownRef.current);
    linkCooldownRef.current = setInterval(() => {
      setLinkCooldown((prev) => {
        if (prev <= 1) {
          if (linkCooldownRef.current) clearInterval(linkCooldownRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  async function handleLinkClick() {
    if (isGuest) {
      router.push("/auth");
      return;
    }
    if (!user || claimingLink) return;
    if (linkCooldown > 0 || linkClicksRemaining <= 0) return;

    setClaimingLink(true);
    try {
      if (Platform.OS === "web") {
        window.open(OFFER_LINK_URL, "_blank");
      } else {
        await Linking.openURL(OFFER_LINK_URL);
      }

      await new Promise((r) => setTimeout(r, 3000));

      const res = await apiRequest("POST", "/api/earn/link-click", { userId: user.id });
      const data = await res.json();
      if (data.success) {
        const updatedUser = { ...user, credits: user.credits + 1 };
        await updateUser(updatedUser);
        setLinkClicksRemaining(data.remaining);
        setMessage({ text: "+1 credit earned!", type: "success" });
        startLinkCooldown(30000);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        setMessage({ text: data.error || "Could not award credit", type: "error" });
        if (data.cooldownMs) startLinkCooldown(data.cooldownMs);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } catch (err: any) {
      let msg = "Failed to award credit";
      try {
        const parsed = JSON.parse(err?.message || "{}");
        if (parsed.error) msg = parsed.error;
      } catch {}
      setMessage({ text: msg, type: "error" });
    } finally {
      setClaimingLink(false);
    }
  }

  async function handleBuyCredits(pkg: CreditPackage) {
    if (isGuest) {
      router.push("/auth");
      return;
    }
    if (!user) return;
    setPurchasing(pkg.id);
    try {
      const paypalLinks: Record<string, string> = {
        "pro_pack": "https://www.paypal.com/ncp/payment/R39384B5P4SMG",
        "starter_pack": "https://www.paypal.com/ncp/payment/WD54CP3YU6PHW",
        "pkg_1500": "https://www.paypal.com/ncp/payment/R39384B5P4SMG",
        "pkg_600": "https://www.paypal.com/ncp/payment/WD54CP3YU6PHW",
      };
      const directLink = paypalLinks[pkg.id];
      if (directLink) {
        if (Platform.OS === "web") {
          window.open(directLink, "_blank");
        } else {
          await Linking.openURL(directLink);
        }
      } else {
        const res = await apiRequest("POST", "/api/paypal/create-order", {
          packageId: pkg.id,
          userId: user.id,
        });
        const data = await res.json();
        if (data.approvalUrl) {
          if (Platform.OS === "web") {
            window.open(data.approvalUrl, "_blank");
          } else {
            await Linking.openURL(data.approvalUrl);
          }
        } else {
          setMessage({ text: "Could not create PayPal order", type: "error" });
        }
      }
    } catch (err: any) {
      setMessage({ text: "Payment failed. Please try again.", type: "error" });
    } finally {
      setPurchasing(null);
    }
  }

  async function fetchAdStatus() {
    if (!user) return;
    try {
      const res = await apiRequest("GET", `/api/earn/status?userId=${user.id}`);
      const data = await res.json();
      setAdsRemaining(data.remaining);
      if (data.cooldownMs > 0) {
        startCooldown(data.cooldownMs);
      }
    } catch {}
  }

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

  const currentCredits = user
    ? Math.max(0, user.freeTrialMessages - user.usedMessages + user.credits)
    : 0;

  const awardCredit = useCallback(async () => {
    if (!user || awarding) return;
    setAwarding(true);
    try {
      const res = await apiRequest("POST", "/api/earn/watch-video", { userId: user.id });
      const data = await res.json();
      if (data.success) {
        const updatedUser = { ...user, credits: user.credits + 1 };
        await updateUser(updatedUser);
        setAdsRemaining(data.remaining);
        setMessage({ text: "+1 credit earned!", type: "success" });
        startCooldown(60000);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        setMessage({ text: data.error || "Could not award credit", type: "error" });
        if (data.cooldownMs) startCooldown(data.cooldownMs);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } catch (err: any) {
      let msg = "Failed to award credit";
      try {
        const parsed = JSON.parse(err?.message || "{}");
        if (parsed.error) msg = parsed.error;
      } catch {}
      setMessage({ text: msg, type: "error" });
    } finally {
      setAwarding(false);
      setShowPlayer(false);
    }
  }, [user, awarding, updateUser]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const handler = (event: MessageEvent) => {
      if (event.data?.type === "AD_COMPLETE") {
        awardCredit();
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [awardCredit]);

  function handleWatchVideo() {
    if (isGuest) {
      router.push("/auth");
      return;
    }
    if (!user) return;
    if (cooldown > 0) return;
    if (adsRemaining <= 0) {
      setMessage({ text: "Daily limit reached! Come back tomorrow.", type: "error" });
      return;
    }
    setMessage(null);
    setShowPlayer(true);
    setLoading(true);
    setTimeout(() => setLoading(false), 2000);
  }

  async function sendSupportMsg() {
    if (!supportSubject.trim() || !supportMessage.trim()) return;
    setSendingSupport(true);
    try {
      await apiRequest("POST", "/api/support/messages", {
        userId: user?.id || "guest",
        userName: user?.name || "Guest",
        userEmail: user?.email || "",
        subject: supportSubject.trim(),
        message: supportMessage.trim(),
      });
      Alert.alert("Sent!", "Your support message has been sent. Our team will get back to you soon.");
      setSupportSubject("");
      setSupportMessage("");
      setShowSupportModal(false);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to send message");
    } finally {
      setSendingSupport(false);
    }
  }

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: topInset + 16, paddingBottom: bottomInset + 100 },
        ]}
        showsVerticalScrollIndicator={false}
      >
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

        <Text style={styles.sectionTitle}>Earn Free Credits</Text>
        <Text style={styles.sectionSubtitle}>
          Watch a short advert to earn 1 free credit. Up to 10 per day!
        </Text>

        <View style={styles.earnCard}>
          <View style={styles.earnStatsRow}>
            <View style={styles.earnStat}>
              <Text style={styles.earnStatValue}>{adsRemaining}</Text>
              <Text style={styles.earnStatLabel}>remaining today</Text>
            </View>
            <View style={styles.earnStatDivider} />
            <View style={styles.earnStat}>
              <Text style={styles.earnStatValue}>1</Text>
              <Text style={styles.earnStatLabel}>credit per advert</Text>
            </View>
            <View style={styles.earnStatDivider} />
            <View style={styles.earnStat}>
              <Text style={styles.earnStatValue}>10</Text>
              <Text style={styles.earnStatLabel}>daily max</Text>
            </View>
          </View>
        </View>

        {message && (
          <View style={[styles.messageCard, message.type === "success" ? styles.messageSuccess : styles.messageError]}>
            <Ionicons
              name={message.type === "success" ? "checkmark-circle" : "alert-circle"}
              size={20}
              color={message.type === "success" ? C.success : C.danger}
            />
            <Text style={[styles.messageText, { color: message.type === "success" ? C.success : C.danger }]}>
              {message.text}
            </Text>
          </View>
        )}

        <View style={styles.videoContainer}>
          {showPlayer ? (
            <View style={styles.playerWrap}>
              {loading && (
                <View style={styles.loadingOverlay}>
                  <ActivityIndicator size="large" color={C.tint} />
                  <Text style={styles.loadingText}>Loading advert...</Text>
                </View>
              )}
              {Platform.OS === "web" ? (
                <iframe
                  ref={iframeRef as any}
                  srcDoc={buildAdMobPlayerHtml()}
                  style={{
                    width: "100%",
                    height: 380,
                    border: "none",
                    borderRadius: 12,
                    backgroundColor: "#0A0E1A",
                  }}
                  sandbox="allow-scripts allow-same-origin allow-popups"
                  allow="autoplay; encrypted-media"
                />
              ) : (
                <View style={styles.mobilePlayerFallback}>
                  <Ionicons name="videocam" size={48} color={C.tint} />
                  <Text style={styles.mobilePlayerText}>
                    Watch a short advert to earn credits
                  </Text>
                  <Pressable
                    onPress={() => awardCredit()}
                    style={({ pressed }) => [styles.mobileClaimBtn, { opacity: pressed ? 0.85 : 1 }]}
                  >
                    <Text style={styles.mobileClaimBtnText}>Watch & Claim Credit</Text>
                  </Pressable>
                </View>
              )}
              {awarding && (
                <View style={styles.awardingOverlay}>
                  <ActivityIndicator size="small" color={C.tint} />
                  <Text style={styles.awardingText}>Awarding credit...</Text>
                </View>
              )}
            </View>
          ) : (
            <Pressable
              onPress={handleWatchVideo}
              disabled={cooldown > 0 || adsRemaining <= 0}
              style={({ pressed }) => [
                styles.watchBtn,
                { opacity: cooldown > 0 || adsRemaining <= 0 ? 0.5 : pressed ? 0.85 : 1 },
              ]}
              testID="watch-video-btn"
            >
              <LinearGradient
                colors={cooldown > 0 || adsRemaining <= 0 ? [C.card, C.card] : [C.tint, C.accent]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.watchBtnInner}
              >
                <Ionicons
                  name={cooldown > 0 ? "time" : adsRemaining <= 0 ? "close-circle" : "play-circle"}
                  size={28}
                  color="#FFF"
                />
                <Text style={styles.watchBtnText}>
                  {cooldown > 0
                    ? `Wait ${cooldown}s...`
                    : adsRemaining <= 0
                    ? "Daily Limit Reached"
                    : "Watch Advert"}
                </Text>
              </LinearGradient>
            </Pressable>
          )}
        </View>

        <View style={styles.earnInfoCard}>
          <Text style={styles.earnInfoTitle}>How it works</Text>
          <View style={styles.earnInfoStep}>
            <View style={styles.stepDot}><Text style={styles.stepDotText}>1</Text></View>
            <Text style={styles.earnInfoText}>Tap "Watch Advert" to start</Text>
          </View>
          <View style={styles.earnInfoStep}>
            <View style={styles.stepDot}><Text style={styles.stepDotText}>2</Text></View>
            <Text style={styles.earnInfoText}>Watch the short advert until it finishes</Text>
          </View>
          <View style={styles.earnInfoStep}>
            <View style={styles.stepDot}><Text style={styles.stepDotText}>3</Text></View>
            <Text style={styles.earnInfoText}>Earn 1 credit instantly - up to 10 per day</Text>
          </View>
        </View>

        <View style={styles.adCard}>
          <View style={styles.adCardHeader}>
            <View style={styles.adCardIconWrap}>
              <Ionicons name="logo-google" size={22} color="#4285F4" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.adCardTitle}>Powered by Google AdMob</Text>
              <Text style={styles.adCardSub}>Watch rewarded adverts to earn credits and support the platform</Text>
            </View>
          </View>
        </View>

        <View style={styles.linkEarnSection}>
          <Text style={styles.sectionTitle}>Quick Credit</Text>
          <Text style={styles.sectionSubtitle}>
            Visit our sponsor page to earn 1 free credit. Up to {MAX_LINK_CLICKS_PER_DAY} per day!
          </Text>

          <View style={styles.linkCard}>
            <View style={styles.linkStatsRow}>
              <View style={styles.earnStat}>
                <Text style={styles.earnStatValue}>{linkClicksRemaining}</Text>
                <Text style={styles.earnStatLabel}>remaining today</Text>
              </View>
              <View style={styles.earnStatDivider} />
              <View style={styles.earnStat}>
                <Text style={styles.earnStatValue}>1</Text>
                <Text style={styles.earnStatLabel}>credit per visit</Text>
              </View>
              <View style={styles.earnStatDivider} />
              <View style={styles.earnStat}>
                <Text style={styles.earnStatValue}>{MAX_LINK_CLICKS_PER_DAY}</Text>
                <Text style={styles.earnStatLabel}>daily max</Text>
              </View>
            </View>

            <Pressable
              onPress={handleLinkClick}
              disabled={linkCooldown > 0 || linkClicksRemaining <= 0 || claimingLink}
              style={({ pressed }) => [
                styles.linkBtn,
                { opacity: linkCooldown > 0 || linkClicksRemaining <= 0 || claimingLink ? 0.5 : pressed ? 0.85 : 1 },
              ]}
              testID="link-credit-btn"
            >
              <LinearGradient
                colors={linkCooldown > 0 || linkClicksRemaining <= 0 ? [C.card, C.card] : ["#8B5CF6", "#6D28D9"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.linkBtnInner}
              >
                {claimingLink ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Ionicons
                    name={linkCooldown > 0 ? "time" : linkClicksRemaining <= 0 ? "close-circle" : "open-outline"}
                    size={24}
                    color="#FFF"
                  />
                )}
                <Text style={styles.linkBtnText}>
                  {claimingLink
                    ? "Earning credit..."
                    : linkCooldown > 0
                    ? `Wait ${linkCooldown}s...`
                    : linkClicksRemaining <= 0
                    ? "Daily Limit Reached"
                    : "Visit & Earn 1 Credit"}
                </Text>
              </LinearGradient>
            </Pressable>
          </View>
        </View>

        <View style={styles.buySectionDivider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        <Text style={styles.sectionTitle}>Buy Credits</Text>
        <Text style={styles.sectionSubtitle}>
          Get more credits instantly with PayPal. Best value with the Pro Pack!
        </Text>

        {packages.map((pkg, index) => {
          const isPopular = index === 1;
          return (
            <View key={pkg.id} style={[styles.pkgCard, isPopular && styles.pkgCardPopular]}>
              {isPopular && (
                <View style={styles.pkgBadge}>
                  <Text style={styles.pkgBadgeText}>BEST VALUE</Text>
                </View>
              )}
              <View style={styles.pkgRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pkgName}>{pkg.name}</Text>
                  <Text style={styles.pkgCredits}>{pkg.credits.toLocaleString()} credits</Text>
                  <Text style={styles.pkgDesc}>{pkg.description}</Text>
                </View>
                <View style={styles.pkgPriceWrap}>
                  <Text style={styles.pkgPrice}>
                    {pkg.currency === "GBP" ? "\u00A3" : "$"}{pkg.price.toFixed(2)}
                  </Text>
                  <Text style={styles.pkgPerCredit}>
                    {((pkg.price / pkg.credits) * 100).toFixed(1)}p/credit
                  </Text>
                </View>
              </View>
              <Pressable
                onPress={() => handleBuyCredits(pkg)}
                disabled={purchasing === pkg.id}
                style={({ pressed }) => [
                  styles.buyBtn,
                  isPopular && styles.buyBtnPopular,
                  { opacity: purchasing === pkg.id ? 0.6 : pressed ? 0.85 : 1 },
                ]}
                testID={`buy-${pkg.id}`}
              >
                {purchasing === pkg.id ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <>
                    <Ionicons name="logo-paypal" size={20} color="#FFF" />
                    <Text style={styles.buyBtnText}>Pay with PayPal</Text>
                  </>
                )}
              </Pressable>
            </View>
          );
        })}

        <View style={styles.paypalInfoCard}>
          <View style={styles.adCardHeader}>
            <View style={[styles.adCardIconWrap, { backgroundColor: "#0070BA20" }]}>
              <Ionicons name="logo-paypal" size={22} color="#0070BA" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.adCardTitle}>Secure PayPal Payments</Text>
              <Text style={styles.adCardSub}>Credits are added instantly after payment. All transactions are processed securely through PayPal.</Text>
            </View>
          </View>
        </View>

        <View style={styles.supportSection}>
          <View style={styles.supportDivider}>
            <View style={styles.dividerLine} />
          </View>
          <Text style={styles.supportHeading}>Need Help?</Text>
          <Text style={styles.supportDesc}>
            Having issues with credits, payments, or anything else? Reach out and we will get back to you.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.supportBtn, { opacity: pressed ? 0.85 : 1 }]}
            onPress={() => setShowSupportModal(true)}
            testID="contact-support-btn"
          >
            <Ionicons name="chatbubble-ellipses-outline" size={20} color="#FFF" />
            <Text style={styles.supportBtnText}>Contact Support</Text>
          </Pressable>
        </View>
      </ScrollView>

      <Modal visible={showSupportModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Contact Support</Text>
              <Pressable onPress={() => setShowSupportModal(false)}>
                <Ionicons name="close" size={24} color={C.text} />
              </Pressable>
            </View>
            <TextInput
              style={styles.modalInput}
              value={supportSubject}
              onChangeText={setSupportSubject}
              placeholder="Subject"
              placeholderTextColor={C.textTertiary}
              testID="support-subject"
            />
            <TextInput
              style={[styles.modalInput, { height: 120, textAlignVertical: "top" }]}
              value={supportMessage}
              onChangeText={setSupportMessage}
              placeholder="Describe your issue..."
              placeholderTextColor={C.textTertiary}
              multiline
              testID="support-message"
            />
            <Pressable
              style={[
                styles.modalSendBtn,
                (sendingSupport || !supportSubject.trim() || !supportMessage.trim()) && { opacity: 0.5 },
              ]}
              onPress={sendSupportMsg}
              disabled={sendingSupport || !supportSubject.trim() || !supportMessage.trim()}
              testID="support-send"
            >
              {sendingSupport ? (
                <ActivityIndicator color="#fff" size={14} />
              ) : (
                <>
                  <Ionicons name="send" size={16} color="#fff" />
                  <Text style={styles.modalSendText}>Send Message</Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  scrollContent: { paddingHorizontal: 20 },
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
  videoContainer: {
    marginBottom: 24,
  },
  playerWrap: {
    backgroundColor: C.card,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: C.borderLight,
  },
  loadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(10,14,26,0.85)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
    borderRadius: 16,
  },
  loadingText: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    color: C.textSecondary,
    marginTop: 12,
  },
  awardingOverlay: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 12,
    backgroundColor: C.tint + "15",
  },
  awardingText: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    color: C.tint,
  },
  mobilePlayerFallback: {
    padding: 40,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  mobilePlayerText: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: C.textSecondary,
    textAlign: "center",
  },
  mobileClaimBtn: {
    backgroundColor: C.tint,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 8,
  },
  mobileClaimBtnText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    color: "#FFF",
  },
  watchBtn: {
    borderRadius: 16,
    overflow: "hidden",
  },
  watchBtnInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingVertical: 22,
    borderRadius: 16,
  },
  watchBtnText: {
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
    backgroundColor: "#4285F4" + "20",
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
  linkEarnSection: {
    marginTop: 28,
  },
  linkCard: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 20,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#8B5CF6" + "30",
  },
  linkStatsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    marginBottom: 20,
  },
  linkBtn: {
    borderRadius: 14,
    overflow: "hidden",
  },
  linkBtnInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingVertical: 18,
    borderRadius: 14,
  },
  linkBtnText: {
    fontFamily: "Inter_700Bold",
    fontSize: 17,
    color: "#FFF",
  },
  buySectionDivider: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginVertical: 28,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: C.borderLight,
  },
  dividerText: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    color: C.textTertiary,
  },
  pkgCard: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: C.borderLight,
  },
  pkgCardPopular: {
    borderColor: C.tint + "60",
    backgroundColor: C.tint + "08",
  },
  pkgBadge: {
    alignSelf: "flex-start",
    backgroundColor: C.tint + "20",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    marginBottom: 12,
  },
  pkgBadgeText: {
    fontFamily: "Inter_700Bold",
    fontSize: 11,
    color: C.tint,
    letterSpacing: 0.5,
  },
  pkgRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  pkgName: {
    fontFamily: "Inter_700Bold",
    fontSize: 18,
    color: C.text,
    marginBottom: 4,
  },
  pkgCredits: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: C.tint,
    marginBottom: 4,
  },
  pkgDesc: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: C.textSecondary,
  },
  pkgPriceWrap: {
    alignItems: "flex-end",
  },
  pkgPrice: {
    fontFamily: "Inter_700Bold",
    fontSize: 28,
    color: C.text,
  },
  pkgPerCredit: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: C.textTertiary,
    marginTop: 2,
  },
  buyBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#0070BA",
    paddingVertical: 14,
    borderRadius: 12,
  },
  buyBtnPopular: {
    backgroundColor: C.tint,
  },
  buyBtnText: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
    color: "#FFF",
  },
  paypalInfoCard: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 20,
    marginTop: 8,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: C.borderLight,
  },
  supportSection: {
    marginTop: 12,
    marginBottom: 20,
    alignItems: "center",
  },
  supportDivider: {
    width: "100%",
    marginBottom: 20,
  },
  supportHeading: {
    fontFamily: "Inter_700Bold",
    fontSize: 18,
    color: C.text,
    marginBottom: 8,
  },
  supportDesc: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: C.textSecondary,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  supportBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: C.accent,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 14,
    width: "100%",
  },
  supportBtnText: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
    color: "#FFF",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: C.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  modalTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 20,
    color: C.text,
  },
  modalInput: {
    width: "100%",
    backgroundColor: "#131C2E",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: C.text,
    borderWidth: 1,
    borderColor: "rgba(0, 212, 170, 0.25)",
    marginBottom: 12,
    fontFamily: "Inter_400Regular",
  },
  modalSendBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.tint,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 8,
    gap: 8,
  },
  modalSendText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    color: "#FFF",
  },
});
