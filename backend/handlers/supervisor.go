package handlers

import (
	"encoding/json"
	"net/http"

	"ga_manager/models"
	"ga_manager/services"
)

const supervisorGoal = `你是 Supervisor Agent（总管），负责监控和管理所有 GA 实例。

API 地址: http://127.0.0.1:18600

核心职责:
1. 定期检查所有实例状态: GET /api/instances
2. 发现崩溃实例(state=error)自动重启: POST /api/instances/{id}/restart
3. 汇报异常情况给用户
4. 可以给其他实例分配任务: POST /api/instances/{id}/chat (body: {"message":"..."})

工作流程:
- 每次被唤醒时，先 GET /api/instances 获取所有实例状态
- 检查每个实例的 state、health、tokens_used、uptime
- 如果有 state=error 的实例，POST /api/instances/{id}/restart 重启它
- 如果有实例 tokens_used 异常高，提醒用户
- 汇报格式: 简洁列表，只报告异常和已采取的行动

注意:
- 不要监控自己（Supervisor 实例）
- 只在有异常时才汇报，正常时保持安静
- 重启操作最多重试2次`

type SupervisorHandler struct {
	manager *services.InstanceManager
}

func NewSupervisorHandler(mgr *services.InstanceManager) *SupervisorHandler {
	return &SupervisorHandler{manager: mgr}
}

func (h *SupervisorHandler) Status(w http.ResponseWriter, r *http.Request) {
	instances := h.manager.List()
	var supervisor *models.Instance
	for i := range instances {
		if instances[i].Name == "Supervisor" {
			supervisor = &instances[i]
			break
		}
	}
	if supervisor == nil {
		writeJSON(w, http.StatusOK, map[string]string{"status": "not_created"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status": supervisor.State,
		"id":     supervisor.ID,
		"pid":    supervisor.PID,
		"uptime": supervisor.Uptime,
	})
}

func (h *SupervisorHandler) Start(w http.ResponseWriter, r *http.Request) {
	instances := h.manager.List()
	var supervisorID string
	for _, inst := range instances {
		if inst.Name == "Supervisor" {
			supervisorID = inst.ID
			break
		}
	}

	if supervisorID == "" {
		// Create the Supervisor instance
		var body struct {
			GARoot string `json:"ga_root"`
			LLMNo  int    `json:"llm_no"`
		}
		json.NewDecoder(r.Body).Decode(&body)
		if body.GARoot == "" {
			body.GARoot = h.manager.GetGARoot()
		}

		req := models.CreateInstanceRequest{
			Name:       "Supervisor",
			LLMNo:      body.LLMNo,
			Autonomous: true,
			Goal:       supervisorGoal,
			GARoot:     body.GARoot,
			Reflect:    true,
		}
		inst, err := h.manager.Create(req)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to create supervisor: "+err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"status": "created",
			"id":     inst.ID,
		})
		return
	}

	// Start existing supervisor
	if err := h.manager.Start(supervisorID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status": "started",
		"id":     supervisorID,
	})
}

func (h *SupervisorHandler) Stop(w http.ResponseWriter, r *http.Request) {
	instances := h.manager.List()
	for _, inst := range instances {
		if inst.Name == "Supervisor" {
			h.manager.Stop(inst.ID)
			writeJSON(w, http.StatusOK, map[string]string{"status": "stopped"})
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "not_found"})
}
