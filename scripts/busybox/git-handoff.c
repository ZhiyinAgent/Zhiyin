/*
 * The git a sealed-off shell finds. git cannot start in an app container, so
 * this program hands its arguments, its folder and its streams to Zhiyin,
 * which runs git outside the container and answers with git's output and
 * exit code. It holds no authority: Zhiyin decides what runs.
 *
 * It opens the pipe the variable ZHIYIN_GIT names, which only its container
 * may open. Every message is a frame: one byte saying what it is, four bytes
 * of length, least significant first, then that many bytes.
 *
 *   to Zhiyin:   'A' the folder, then each argument, UTF-8, each ended by NUL
 *                'I' bytes of standard input, and 'E' at its end
 *   from Zhiyin: 'O' bytes for standard output, 'R' for standard error
 *                'X' four bytes, the exit code
 *
 * Built with w64devkit's gcc by scripts/busybox.mjs, beside busybox.
 */

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shellapi.h>
#include <stdlib.h>
#include <string.h>

#define MAXIMUM_FRAME (8u << 20)

static HANDLE pipe_handle;

static void say(const char *text)
{
	DWORD written;
	WriteFile(GetStdHandle(STD_ERROR_HANDLE), text, (DWORD)strlen(text),
			&written, NULL);
}

/* One transfer on the overlapped pipe, waited for: whole, or FALSE. */
static BOOL transfer(BOOL writing, void *buffer, DWORD length)
{
	DWORD done = 0;

	while (done < length) {
		OVERLAPPED overlapped;
		DWORD moved = 0;
		BOOL ok;

		memset(&overlapped, 0, sizeof(overlapped));
		overlapped.hEvent = CreateEventW(NULL, TRUE, FALSE, NULL);
		if (!overlapped.hEvent)
			return FALSE;
		ok = writing
			? WriteFile(pipe_handle, (char *)buffer + done, length - done,
					NULL, &overlapped)
			: ReadFile(pipe_handle, (char *)buffer + done, length - done,
					NULL, &overlapped);
		if (!ok && GetLastError() != ERROR_IO_PENDING) {
			CloseHandle(overlapped.hEvent);
			return FALSE;
		}
		ok = GetOverlappedResult(pipe_handle, &overlapped, &moved, TRUE);
		CloseHandle(overlapped.hEvent);
		if (!ok || moved == 0)
			return FALSE;
		done += moved;
	}
	return TRUE;
}

static BOOL send_frame(char kind, const void *bytes, DWORD length)
{
	unsigned char head[5];

	head[0] = (unsigned char)kind;
	head[1] = (unsigned char)(length & 0xff);
	head[2] = (unsigned char)((length >> 8) & 0xff);
	head[3] = (unsigned char)((length >> 16) & 0xff);
	head[4] = (unsigned char)((length >> 24) & 0xff);
	return transfer(TRUE, head, sizeof(head)) &&
		(length == 0 || transfer(TRUE, (void *)bytes, length));
}

/* Appends a wide string as UTF-8 and a NUL; FALSE when it cannot. */
static BOOL append_utf8(char **buffer, DWORD *used, DWORD *size,
		const wchar_t *text)
{
	int needed = WideCharToMultiByte(CP_UTF8, 0, text, -1, NULL, 0, NULL,
			NULL);

	if (needed <= 0)
		return FALSE;
	while (*used + (DWORD)needed > *size) {
		char *grown = realloc(*buffer, *size * 2);
		if (!grown)
			return FALSE;
		*buffer = grown;
		*size *= 2;
	}
	WideCharToMultiByte(CP_UTF8, 0, text, -1, *buffer + *used, needed, NULL,
			NULL);
	*used += (DWORD)needed;
	return *used <= MAXIMUM_FRAME;
}

static DWORD WINAPI send_input(LPVOID unused)
{
	HANDLE input = GetStdHandle(STD_INPUT_HANDLE);
	char buffer[65536];
	DWORD read;

	(void)unused;
	if (input && input != INVALID_HANDLE_VALUE)
		while (ReadFile(input, buffer, sizeof(buffer), &read, NULL) &&
				read > 0)
			if (!send_frame('I', buffer, read))
				return 0;
	send_frame('E', NULL, 0);
	return 0;
}

static void write_all(HANDLE output, const char *bytes, DWORD length)
{
	DWORD written;

	while (length > 0 && WriteFile(output, bytes, length, &written, NULL) &&
			written > 0) {
		bytes += written;
		length -= written;
	}
}

int main(void)
{
	wchar_t name[512], folder[32768];
	wchar_t **arguments;
	int count, at;
	char *frame;
	DWORD used = 0, size = 65536;
	DWORD length = GetEnvironmentVariableW(L"ZHIYIN_GIT", name, 512);

	if (length == 0 || length >= 512) {
		say("git: this shell runs git through Zhiyin, and Zhiyin "
				"did not give this command a way to reach it.\n");
		return 128;
	}
	for (;;) {
		pipe_handle = CreateFileW(name, GENERIC_READ | GENERIC_WRITE, 0,
				NULL, OPEN_EXISTING, FILE_FLAG_OVERLAPPED, NULL);
		if (pipe_handle != INVALID_HANDLE_VALUE)
			break;
		if (GetLastError() != ERROR_PIPE_BUSY ||
				!WaitNamedPipeW(name, 10000)) {
			say("git: Zhiyin could not be reached to run git.\n");
			return 128;
		}
	}

	length = GetCurrentDirectoryW(32768, folder);
	arguments = CommandLineToArgvW(GetCommandLineW(), &count);
	frame = malloc(size);
	if (length == 0 || length >= 32768 || !arguments || !frame ||
			!append_utf8(&frame, &used, &size, folder)) {
		say("git: the command could not be read.\n");
		return 128;
	}
	for (at = 1; at < count; at++)
		if (!append_utf8(&frame, &used, &size, arguments[at])) {
			say("git: the command is too long to hand to Zhiyin.\n");
			return 128;
		}
	if (!send_frame('A', frame, used)) {
		say("git: Zhiyin could not be reached to run git.\n");
		return 128;
	}
	free(frame);
	CloseHandle(CreateThread(NULL, 0, send_input, NULL, 0, NULL));

	for (;;) {
		unsigned char head[5];
		char *bytes;

		if (!transfer(FALSE, head, sizeof(head)))
			break;
		length = head[1] | (head[2] << 8) | (head[3] << 16) |
			((DWORD)head[4] << 24);
		if (length > MAXIMUM_FRAME)
			break;
		bytes = malloc(length ? length : 1);
		if (!bytes || (length && !transfer(FALSE, bytes, length)))
			break;
		if (head[0] == 'O')
			write_all(GetStdHandle(STD_OUTPUT_HANDLE), bytes, length);
		else if (head[0] == 'R')
			write_all(GetStdHandle(STD_ERROR_HANDLE), bytes, length);
		else if (head[0] == 'X' && length == 4) {
			int code = (unsigned char)bytes[0] |
				((unsigned char)bytes[1] << 8) |
				((unsigned char)bytes[2] << 16) |
				((unsigned char)bytes[3] << 24);
			ExitProcess((UINT)code);
		}
		free(bytes);
	}
	say("git: the connection to Zhiyin ended before git did.\n");
	return 128;
}
