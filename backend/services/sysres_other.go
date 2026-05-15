//go:build !windows

package services

import (
	"os/exec"
	"runtime"
	"strconv"
	"strings"
)

func getSystemStats() SystemResources {
	var sr SystemResources

	if runtime.GOOS == "darwin" {
		// macOS: use sysctl and vm_stat
		out, err := exec.Command("sh", "-c", "ps -A -o %cpu | awk '{s+=$1} END {print s}'").Output()
		if err == nil {
			sr.CPUPercent, _ = strconv.ParseFloat(strings.TrimSpace(string(out)), 64)
		}

		// Total memory via sysctl
		out, err = exec.Command("sysctl", "-n", "hw.memsize").Output()
		if err == nil {
			bytes, _ := strconv.ParseFloat(strings.TrimSpace(string(out)), 64)
			sr.MemTotalMB = bytes / 1024 / 1024
		}

		// Used memory via vm_stat
		out, err = exec.Command("sh", "-c", "vm_stat | awk '/Pages (active|inactive|wired)/ {sum += $NF} END {print sum}'").Output()
		if err == nil {
			pages, _ := strconv.ParseFloat(strings.TrimRight(strings.TrimSpace(string(out)), "."), 64)
			sr.MemUsedMB = pages * 4096 / 1024 / 1024
		}

		if sr.MemTotalMB > 0 {
			sr.MemPercent = sr.MemUsedMB / sr.MemTotalMB * 100
		}
	} else {
		// Linux: use top and free
		out, err := exec.Command("sh", "-c", "top -bn1 | grep 'Cpu(s)' | awk '{print $2}'").Output()
		if err == nil {
			sr.CPUPercent, _ = strconv.ParseFloat(strings.TrimSpace(string(out)), 64)
		}

		out, err = exec.Command("sh", "-c", "free -m | awk 'NR==2{print $2,$3}'").Output()
		if err == nil {
			fields := strings.Fields(strings.TrimSpace(string(out)))
			if len(fields) >= 2 {
				total, _ := strconv.ParseFloat(fields[0], 64)
				used, _ := strconv.ParseFloat(fields[1], 64)
				sr.MemTotalMB = total
				sr.MemUsedMB = used
				if total > 0 {
					sr.MemPercent = used / total * 100
				}
			}
		}
	}

	return sr
}
