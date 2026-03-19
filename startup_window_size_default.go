//go:build desktop && !windows && !darwin

package main

func resolveStartupWindowSize() (int, int) {
	return preferredWidth, preferredHeight
}
