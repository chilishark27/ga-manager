//go:build windows

package services

import (
	"os/exec"
	"strconv"
	"strings"
)

func getSystemStats() SystemResources {
	var sr SystemResources

	// CPU: use wmic to get LoadPercentage
	out, err := exec.Command("wmic", "cpu", "get", "LoadPercentage", "/value").Output()
	if err == nil {
		for _, line := range strings.Split(string(out), "\n") {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "LoadPercentage=") {
				val := strings.TrimPrefix(line, "LoadPercentage=")
				sr.CPUPercent, _ = strconv.ParseFloat(strings.TrimSpace(val), 64)
				break
			}
		}
	}

	// Memory: use wmic to get total and free
	out, err = exec.Command("wmic", "OS", "get", "TotalVisibleMemorySize,FreePhysicalMemory", "/value").Output()
	if err == nil {
		var totalKB, freeKB float64
		for _, line := range strings.Split(string(out), "\n") {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "TotalVisibleMemorySize=") {
				val := strings.TrimPrefix(line, "TotalVisibleMemorySize=")
				totalKB, _ = strconv.ParseFloat(strings.TrimSpace(val), 64)
			}
			if strings.HasPrefix(line, "FreePhysicalMemory=") {
				val := strings.TrimPrefix(line, "FreePhysicalMemory=")
				freeKB, _ = strconv.ParseFloat(strings.TrimSpace(val), 64)
			}
		}
		if totalKB > 0 {
			sr.MemTotalMB = totalKB / 1024
			sr.MemUsedMB = (totalKB - freeKB) / 1024
			sr.MemPercent = (totalKB - freeKB) / totalKB * 100
		}
	}

	return sr
}
