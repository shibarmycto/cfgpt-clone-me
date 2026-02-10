import React, { useEffect, useMemo, useRef } from "react";
import { View, Text, StyleSheet, Dimensions, Platform } from "react-native";
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, withDelay, Easing } from "react-native-reanimated";

interface MatrixRainProps {
  color: 'green' | 'red' | 'blue';
  visible: boolean;
}

const COLOR_MAP: Record<string, string> = {
  green: '#00FF41',
  red: '#FF073A',
  blue: '#00D4FF',
};

const MATRIX_CHARS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz@#$%&*+=<>?';

function getRandomChar(): string {
  return MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)];
}

interface ColumnData {
  id: number;
  left: number;
  chars: string[];
  speed: number;
  delay: number;
}

function generateColumns(count: number, screenWidth: number): ColumnData[] {
  const cols: ColumnData[] = [];
  const colWidth = screenWidth / count;
  for (let i = 0; i < count; i++) {
    const charCount = 8 + Math.floor(Math.random() * 5);
    const chars: string[] = [];
    for (let j = 0; j < charCount; j++) {
      chars.push(getRandomChar());
    }
    cols.push({
      id: i,
      left: i * colWidth + Math.random() * (colWidth * 0.5),
      chars,
      speed: 3000 + Math.random() * 5000,
      delay: Math.random() * 4000,
    });
  }
  return cols;
}

function MatrixChar({ char, index, totalChars, rainColor, speed, columnDelay }: {
  char: string;
  index: number;
  totalChars: number;
  rainColor: string;
  speed: number;
  columnDelay: number;
}) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = 0;
    progress.value = withDelay(
      columnDelay + index * 150,
      withRepeat(
        withTiming(1, { duration: speed, easing: Easing.linear }),
        -1,
        false
      )
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => {
    const charOpacity = 1 - (index / totalChars) * 0.8;
    return {
      opacity: charOpacity * (0.3 + progress.value * 0.7),
      transform: [{ translateY: progress.value * 30 }],
    };
  });

  return (
    <Animated.Text
      style={[
        styles.matrixChar,
        { color: rainColor },
        animatedStyle,
      ]}
    >
      {char}
    </Animated.Text>
  );
}

function MatrixColumn({ column, rainColor }: { column: ColumnData; rainColor: string }) {
  const translateY = useSharedValue(-100);

  useEffect(() => {
    translateY.value = -100;
    translateY.value = withDelay(
      column.delay,
      withRepeat(
        withTiming(Dimensions.get('window').height * 0.6, {
          duration: column.speed,
          easing: Easing.linear,
        }),
        -1,
        false
      )
    );
  }, []);

  const columnStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View
      style={[
        styles.column,
        { left: column.left },
        columnStyle,
      ]}
    >
      {column.chars.map((char, idx) => (
        <MatrixChar
          key={idx}
          char={char}
          index={idx}
          totalChars={column.chars.length}
          rainColor={rainColor}
          speed={column.speed}
          columnDelay={column.delay}
        />
      ))}
    </Animated.View>
  );
}

function WebMatrixRain({ columns, rainColor }: { columns: ColumnData[]; rainColor: string }) {
  const styleInjected = useRef(false);

  useEffect(() => {
    if (styleInjected.current) return;
    styleInjected.current = true;
    const style = document.createElement('style');
    style.textContent = `
      @keyframes matrixFall {
        0% { transform: translateY(-150px); }
        100% { transform: translateY(calc(100vh)); }
      }
      .matrix-col {
        position: absolute;
        top: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        animation-name: matrixFall;
        animation-timing-function: linear;
        animation-iteration-count: infinite;
      }
      .matrix-char {
        font-size: 14px;
        font-weight: 300;
        line-height: 18px;
        font-family: 'Courier New', monospace;
      }
    `;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
      styleInjected.current = false;
    };
  }, []);

  return (
    <View style={styles.container} pointerEvents="none">
      {columns.map((col) => (
        <div
          key={col.id}
          className="matrix-col"
          style={{
            left: col.left,
            animationDuration: `${col.speed}ms`,
            animationDelay: `${col.delay}ms`,
          }}
        >
          {col.chars.map((char, idx) => {
            const charOpacity = 1 - (idx / col.chars.length) * 0.8;
            return (
              <span
                key={idx}
                className="matrix-char"
                style={{ color: rainColor, opacity: charOpacity }}
              >
                {char}
              </span>
            );
          })}
        </div>
      ))}
    </View>
  );
}

export default function MatrixRain({ color, visible }: MatrixRainProps) {
  const screenWidth = Dimensions.get('window').width;
  const rainColor = COLOR_MAP[color] || COLOR_MAP.green;

  const columns = useMemo(() => {
    if (!visible) return [];
    const count = Math.min(Math.max(Math.floor(screenWidth / 25), 15), 20);
    return generateColumns(count, screenWidth);
  }, [visible, screenWidth]);

  if (!visible) return null;

  if (Platform.OS === 'web') {
    return <WebMatrixRain columns={columns} rainColor={rainColor} />;
  }

  return (
    <View style={styles.container} pointerEvents="none">
      {columns.map((col) => (
        <MatrixColumn key={col.id} column={col} rainColor={rainColor} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
    opacity: 0.35,
    backgroundColor: 'transparent',
  },
  column: {
    position: 'absolute',
    top: 0,
    alignItems: 'center',
  },
  matrixChar: {
    fontSize: 14,
    fontWeight: '300' as const,
    lineHeight: 18,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
});
