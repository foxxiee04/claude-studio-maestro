# Maestro - hướng dẫn nhanh (bộ điều phối AI, lệnh `maestro` hoặc `oc`)

Claude lên kế hoạch và kiểm tra, opencode viết code bằng model miễn phí. Bạn chủ yếu **xem**.
Lệnh đầy đủ: `maestro <lệnh>` (bên dưới viết tắt là `oc`).

## Xem tiến trình

Gõ `oc` ở bất kỳ terminal nào (PowerShell, CMD, Bash) - lệnh tắt nằm trong thư mục npm global.

**Cách dễ nhất: gõ `maestro`** (không kèm gì) - mở cửa sổ ứng dụng Maestro. Server chạy ngầm, không có cửa sổ terminal nào
(không sợ tắt nhầm); gõ lại `maestro` chỉ mở thêm cửa sổ, tắt hẳn bằng `maestro close`. Địa chỉ http://localhost:4790, gồm: công việc nhóm theo dự án (bấm vào một dòng để xem log chạy trực tiếp, chuỗi model dự phòng,
file đã sửa), bảng model đang được chọn cho từng loại việc, và **tiến trình đang chạy** (job opencode, `oc batch`/`oc run`,
dev server, từng cửa sổ PowerShell và số tiến trình con của nó). Tự làm mới mỗi 2 giây.

Trong app Claude, Claude cũng mở tab "opencode jobs" ở **Terminal panel** (khung terminal cạnh cuộc trò chuyện).

| Lệnh | Tác dụng |
|---|---|
| `maestro` (hoặc `maestro open`, `maestro dashboard`) | Mở **cửa sổ ứng dụng Maestro** (Edge, không tab, không thanh địa chỉ), tự bật server ngầm nếu chưa chạy |
| `maestro close` | Tắt dashboard đang chạy ngầm |
| `maestro status` | Dashboard có đang chạy không, pid, file log |
| `maestro restart` | Chạy lại server ngầm (sau khi cập nhật giao diện) |
| `maestro web --open` | Mở dashboard trong một tab trình duyệt |
| `oc dash` | Dashboard trực tiếp: các job, model, thời gian, token, file, log chạy. Phím `1-9` ghim job, `a` theo job mới nhất, `m` bảng xếp hạng model, `q` thoát |
| `oc list` | Danh sách job gần đây |
| `oc report last` | Báo cáo job mới nhất (hoặc theo id/tên) |
| `oc log <id>` | Log chi tiết của một job |
| `oc stop <id>` / `oc stop lost` | Dừng một job / dọn các job mồ côi |
| `oc pause <id>` / `oc resume <id>` | Tạm dừng / tiếp tục một job đang chạy (đóng băng tiến trình; dừng lâu có thể làm model mất kết nối - khi đó job tự chạy lại bằng model dự phòng) |
| `oc pause-batch last` / `oc resume-batch last` | Tạm dừng / tiếp tục cả kế hoạch: job đang chạy vẫn chạy, không khởi động job mới |

## Chọn model

- Mỗi job có một **kind**: `quick` (sửa nhỏ, ưu tiên nhanh), `code` (logic), `ui` (giao diện React/motion), `hard` (khó, nhiều file).
- `oc` tự chọn model tốt nhất theo kind và giữ sẵn 2 model dự phòng. Model miễn phí sập thì tự chuyển sang model
  khác (chỉ khi chưa sửa file nào), và model vừa sập sẽ bị bỏ qua trong 30 phút.
- Điểm chất lượng của model = **số liệu benchmark công khai** (SWE-bench, DeepSWE, Terminal-Bench) trộn với
  **benchmark có test ẩn** của Maestro, nhân độ ổn định thực tế, cộng đánh giá good/bad mà Claude chấm sau mỗi job
  (`oc rate`). Model mới (ví dụ vừa gắn key) được xếp ngay theo số liệu công khai của dòng model đó.
- Mỗi model có **mức năng lực 1-5**: việc `hard` cần mức 4+, `code`/`ui` 3+, `quick` 2+.

| Lệnh | Tác dụng |
|---|---|
| `oc pick` | Bảng xếp hạng model cho từng kind và model sẽ được dùng |
| `oc models` | Bảng đầy đủ: điểm từng bài benchmark, số job, số lần sập, good/bad |
| `oc bench` | Chạy lại benchmark cho mọi model (20-40 phút; nên chạy trong một tab Terminal) |
| `oc bench <model> --tasks ui` | Benchmark một model / một bài |

Benchmark gồm 3 bài, chấm bằng test ẩn mà model không thấy: **fix** (sửa 4 bug cho test qua), **code** (viết 3 hàm
theo spec, 24 kiểm tra), **ui** (component React + TypeScript + motion, kiểm tra type + render).

## Gắn API key (OpenAI, OpenRouter, Groq, ...)

Key do opencode cất giữ; Maestro không đọc, không lưu key, chỉ biết nhà cung cấp nào đã gắn.

| Lệnh | Tác dụng |
|---|---|
| `maestro keys` | Danh sách nhà cung cấp: đã gắn key chưa, bật/tắt, loại (trả phí / có gói miễn phí), ngân sách, đã dùng hôm nay |
| `maestro keys add openrouter` | Gắn key (opencode hỏi key, mở trang lấy key ở cột link) |
| `maestro keys enable openrouter --budget 2` | Bật nhà cung cấp, ngân sách 2 USD/ngày |
| `maestro keys budget openai 5` | Đổi ngân sách/ngày |
| `maestro keys disable groq` / `maestro keys remove groq` | Tắt / gỡ key |

- Nhà cung cấp mới gắn mặc định **tắt**; bật trong `maestro keys enable` hoặc Cài đặt > Nhà cung cấp trên dashboard.
- Nhà cung cấp **trả phí** chỉ được dùng khi job có `--paid` (batch `"paid": true`) **và** đã đặt ngân sách; dùng
  hết ngân sách trong ngày thì Maestro tự bỏ qua tới hôm sau. Model `:free` của OpenRouter không tính tiền.
- Nhà cung cấp **có gói miễn phí** (Google AI Studio, Groq, Cerebras) khi bật thì tham gia chọn tự động như model miễn phí.

## An toàn

- opencode không bao giờ được stage, commit hay push (bị chặn trong cấu hình opencode và bằng hook của Claude Code).
- Mỗi job bị giới hạn trong thư mục project: đường dẫn bên ngoài bị từ chối, file tạm nằm ở `.oc-tmp/` và bị xoá sau khi chạy.
- Job chỉ được sửa các file trong **scope** của nó. Sửa ra ngoài sẽ hiện cảnh báo `!scope` trên dashboard và trong báo cáo.

## Dữ liệu nằm ở đâu

- Job: `%TEMP%\opencode-jobs\<id>\` (job.json, job.log, brief.md, events.jsonl). `oc clean --days 7` để dọn.
- Điểm benchmark: `models.json`. Thống kê job thật và đánh giá: `stats.json` (cùng thư mục skill).
