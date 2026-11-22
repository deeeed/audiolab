import FontAwesome from '@expo/vector-icons/FontAwesome'
import { Tabs } from 'expo-router'
import { GestureHandlerRootView } from 'react-native-gesture-handler'

export default function RootLayout() {
    return (
        <GestureHandlerRootView style={{ flex: 1 }}>
            <Tabs>
                <Tabs.Screen
                    name="index"
                    options={{
                        title: 'Home',
                        // RN 0.88's ColorValue also admits null and numbers, which the icon color prop omits.
                        tabBarIcon: ({ color }) => (
                            <FontAwesome
                                size={28}
                                name="home"
                                color={color as string}
                            />
                        ),
                    }}
                />
            </Tabs>
        </GestureHandlerRootView>
    )
}
