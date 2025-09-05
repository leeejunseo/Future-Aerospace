// --- 전역 변수 및 설정 (이전과 동일) ---
let mannedFighter;
let uavs = [], targets = [], sams = [], explosions = [], samFires = [];
let simulationRunning = false;
let simulationMode = 'none'; // 'all-out', 'mumt'
let ticks = 0;
let config = {
    numUAVs: 5,
    numTargets: 8,
    numSAMs: 3
};
const UAV_SPEED = 2.8;
const FIGHTER_SPEED = 3.0;
const SAM_RANGE = 120;
const UAV_COLORS = [ [100, 180, 255], [150, 255, 100], [255, 100, 255], [100, 255, 255], [255, 255, 100], [180, 100, 255], [100, 255, 180], [255, 180, 100], [200, 100, 100], [100, 200, 100]];

// --- p5.js 핵심 함수 (이전과 동일) ---
function setup() {
    let canvasContainer = document.getElementById('canvas-container');
    let canvas = createCanvas(canvasContainer.offsetWidth, canvasContainer.offsetHeight);
    canvas.parent('canvas-container');
    window.addEventListener('resize', () => {
        resizeCanvas(canvasContainer.offsetWidth, canvasContainer.offsetHeight);
        initializeSimulation();
    });
    
    setupControls();
    initializeSimulation();
    noLoop();
}

function draw() {
    background(26, 26, 46, 200);
    drawGrid();
    if (simulationRunning) {
        ticks++;
        updateSimulationState();
    }
    sams.forEach(sam => sam.draw());
    targets.forEach(target => target.draw());
    uavs.forEach(uav => uav.draw());
    if (simulationMode === 'mumt' && mannedFighter) mannedFighter.draw();
    samFires.forEach((fire, i) => {
        fire.draw();
        if (fire.isFinished()) samFires.splice(i, 1);
    });
    explosions.forEach((exp, i) => {
        exp.draw();
        if (exp.isFinished()) explosions.splice(i, 1);
    });
    if(simulationRunning) updateAllInfo();
}


// --- 클래스 정의 ---
class MannedFighter {
    constructor(x, y) {
        this.pos = createVector(x, y);
        this.vel = createVector(random(-1, 1), random(-1, 1)).setMag(FIGHTER_SPEED); // 초기 속도
        this.acc = createVector(0, 0); // 가속도
        this.maxSpeed = FIGHTER_SPEED;
        this.maxForce = 0.1; // 조향력(기동성)
        this.status = '안전';
        this.path = [];
        this.decisionCooldown = 0;
        // --- 추가된 부분: 펄린 노이즈를 위한 변수 ---
        this.noiseOffsetX = random(1000);
        this.noiseOffsetY = random(1000);
        // -----------------------------------------
    }

    // --- 핵심 수정: AI 지휘관의 update 함수 ---
    update() {
        // 1. 조향력 계산
        let wanderForce = this.wander(); // 자연스러운 비행
        let avoidForce = this.avoidSAMs(); // 위협 회피
        let followForce = this.followSquad(); // 편대 추적

        // 각 조향력에 가중치 적용
        wanderForce.mult(0.3);
        avoidForce.mult(1.0); // 위협 회피를 최우선으로
        followForce.mult(0.5);

        // 계산된 모든 힘을 가속도에 적용
        this.applyForce(wanderForce);
        this.applyForce(avoidForce);
        this.applyForce(followForce);

        // 2. 물리 업데이트 (이동)
        this.vel.add(this.acc);
        this.vel.limit(this.maxSpeed);
        this.pos.add(this.vel);
        this.acc.mult(0); // 매 프레임 가속도 초기화

        // 3. 전술적 의사결정
        this.think();

        // 4. 기타 상태 업데이트
        this.checkStatus();
        if (frameCount % 5 === 0) this.path.push(this.pos.copy());
        if (this.path.length > 30) this.path.shift();
    }

    applyForce(force) {
        this.acc.add(force);
    }
    
    // 1-1. 펄린 노이즈를 이용한 자연스러운 비행 로직
    wander() {
        // 펄린 노이즈를 이용해 -1 ~ 1 사이의 부드러운 랜덤 값 생성
        let angle = noise(this.noiseOffsetX) * TWO_PI * 4 - TWO_PI * 2;
        let wanderPoint = this.vel.copy();
        wanderPoint.setMag(100); // 전방 100픽셀 지점
        wanderPoint.add(this.pos);
        
        let wanderRadius = 50;
        let theta = angle + this.vel.heading();
        let x = wanderRadius * cos(theta);
        let y = wanderRadius * sin(theta);
        wanderPoint.add(x,y);

        this.noiseOffsetX += 0.01;
        this.noiseOffsetY += 0.01;
        
        return this.seek(wanderPoint);
    }

    // 1-2. 위협(SAM) 회피 로직
    avoidSAMs() {
        let avoidance = createVector(0, 0);
        let inDanger = false;
        sams.forEach(sam => {
            let d = p5.Vector.dist(this.pos, sam.pos);
            if (d < sam.range + 30) { // 약간의 여유를 두고 회피 시작
                inDanger = true;
                let diff = p5.Vector.sub(this.pos, sam.pos);
                diff.setMag(1 / d); // 가까울수록 강한 반발력
                avoidance.add(diff);
            }
        });
        if (inDanger) {
            avoidance.setMag(this.maxSpeed);
            let steer = p5.Vector.sub(avoidance, this.vel);
            steer.limit(this.maxForce * 2.0); // 위급 상황이므로 조향력을 높임
            return steer;
        }
        return createVector(0, 0);
    }

    // 1-3. 편대 중심 추적 로직
    followSquad() {
        let center = createVector(0, 0);
        let activeUAVs = uavs.filter(u => u.status !== '파괴됨');
        if (activeUAVs.length > 0) {
            activeUAVs.forEach(uav => center.add(uav.pos));
            center.div(activeUAVs.length);
            return this.seek(center);
        }
        return createVector(0, 0);
    }

    // 특정 목표 지점으로 향하는 조향력을 계산하는 헬퍼 함수
    seek(target) {
        let desired = p5.Vector.sub(target, this.pos);
        desired.setMag(this.maxSpeed);
        let steer = p5.Vector.sub(desired, this.vel);
        steer.limit(this.maxForce);
        return steer;
    }

    checkStatus() {
        this.status = '안전';
        for (let sam of sams) {
            if (p5.Vector.dist(this.pos, sam.pos) < sam.range) {
                this.status = '위험';
                break;
            }
        }
    }

    think() {
        this.decisionCooldown--;
        if (this.decisionCooldown > 0) return;

        let availableUAVs = uavs.filter(u => u.status === '편대비행');
        let activeTargets = targets.filter(t => t.status === '활성' && !t.isTargeted);

        if (availableUAVs.length > 0 && activeTargets.length > 0) {
            let closestTarget = null;
            let minDist = Infinity;
            activeTargets.forEach(t => {
                let d = p5.Vector.dist(this.pos, t.pos);
                if (d < minDist) { minDist = d; closestTarget = t; }
            });

            let bestUAV = null;
            minDist = Infinity;
            availableUAVs.forEach(uav => {
                let d = p5.Vector.dist(uav.pos, closestTarget.pos);
                if (d < minDist) { minDist = d; bestUAV = uav; }
            });

            if (bestUAV && closestTarget) {
                bestUAV.assignTarget(closestTarget);
                closestTarget.isTargeted = true;
                this.decisionCooldown = 90; // 1.5초 후 다음 결정
            }
        }
    }
    // -----------------------------------------

    draw() {
        // 엔진 트레일
        stroke(255, 255, 0, 150);
        strokeWeight(3);
        noFill();
        beginShape();
        this.path.forEach(p => vertex(p.x, p.y));
        endShape();
        
        // 본체
        push();
        translate(this.pos.x, this.pos.y);
        rotate(this.vel.heading());
        fill(255, 220, 0); // 금색
        stroke(255);
        triangle(-15, -8, -15, 8, 20, 0);
        pop();
    }
}


// UAV, Target, SAM 등 나머지 클래스와 함수들은 이전 코드와 동일합니다.
// 편의를 위해 전체 코드를 다시 첨부합니다.

class UAV {
    constructor(id, x, y, color) {
        this.id = id;
        this.pos = createVector(x, y);
        this.vel = createVector(0, 0);
        this.speed = UAV_SPEED;
        this.color = color;
        this.target = null;
        this.status = '편대비행'; // 편대비행, 임무중, 편대복귀중, 파괴됨
        this.path = [];
    }
    
    assignTarget(target) {
        if (this.status !== '파괴됨') {
            this.target = target;
            this.status = '임무중';
            logEvent(`UAV #${this.id}, 표적 #${target.id} 공격 명령 수신!`, 'info');
        }
    }

    returnToFormation() {
        if (this.status !== '파괴됨' && this.status !== '편대비행') {
            if (this.target) this.target.isTargeted = false; // 표적 해제
            this.target = null;
            this.status = '편대복귀중';
            logEvent(`UAV #${this.id} 편대 복귀 시작.`, 'warn');
        }
    }

    update() {
        let destination = null;
        if (this.status === '편대비행' || this.status === '편대복귀중') {
            if (simulationMode === 'mumt' && mannedFighter) {
                let formationSlot;
                let side = (this.id % 2 === 0) ? -1 : 1;
                let rank = floor(this.id / 2) + 1;
                formationSlot = createVector(-50 * rank, 40 * rank * side);
                let heading = mannedFighter.vel.heading();
                destination = formationSlot.rotate(heading).add(mannedFighter.pos);
                if (this.status === '편대복귀중' && p5.Vector.dist(this.pos, destination) < 20) {
                    this.status = '편대비행';
                }
            }
        } else if (this.status === '임무중' && this.target) {
            destination = this.target.pos;
        }

        if (destination) {
            let dir = p5.Vector.sub(destination, this.pos);
            let dist = dir.mag();
            if (dist > this.speed) {
                dir.setMag(this.speed);
                this.pos.add(dir);
                this.vel = dir;
            }
        }
        
        if (this.status === '임무중' && this.target && p5.Vector.dist(this.pos, this.target.pos) < 10) {
            this.attack();
        }

        if (frameCount % 5 === 0) this.path.push(this.pos.copy());
        if (this.path.length > 20) this.path.shift();
    }

    attack() {
        if (this.target && this.target.status === '활성') {
            this.target.status = '파괴됨';
            logEvent(`UAV #${this.id}, 표적 #${this.target.id} 파괴 성공!`, 'success');
            explosions.push(new Explosion(this.target.pos.x, this.target.pos.y));
            if (simulationMode === 'mumt') this.returnToFormation();
            else this.status = '임무완료';
        }
    }

    destroy() {
        if (this.status !== '파괴됨') {
            if (this.target) this.target.isTargeted = false; // 표적 해제
            this.status = '파괴됨';
            logEvent(`UAV #${this.id}, 적 SAM에 의해 파괴됨!`, 'error');
            explosions.push(new Explosion(this.pos.x, this.pos.y, color(255, 165, 0)));
        }
    }

    draw() {
        stroke(this.color.levels[0], this.color.levels[1], this.color.levels[2], 150);
        strokeWeight(2);
        noFill();
        beginShape();
        this.path.forEach(p => vertex(p.x, p.y));
        endShape();

        push();
        translate(this.pos.x, this.pos.y);
        rotate(this.vel.heading());
        if (this.status === '파괴됨') {
            fill(100); stroke(50);
        } else {
            fill(this.color); stroke(this.color);
        }
        strokeWeight(1);
        triangle(-10, -5, -10, 5, 15, 0);
        pop();
    }
}
class Target {
    constructor(id, x, y) {
        this.id = id; this.pos = createVector(x, y); this.status = '활성'; this.isTargeted = false;
    }
    draw() {
        push();
        translate(this.pos.x, this.pos.y);
        if (this.status === '활성') {
            if (this.isTargeted) fill(255, 165, 0); // 타게팅되면 주황색
            else fill(255, 80, 80);
            noStroke(); rectMode(CENTER); rotate(PI / 4); rect(0, 0, 15, 15);
        } else {
            fill(100); noStroke(); ellipse(0, 0, 10, 10);
        }
        pop();
    }
}
class SAM {
    constructor(id, x, y) { this.id = id; this.pos = createVector(x, y); this.range = SAM_RANGE; this.fireRate = 0.005; }
    checkAndFire(unit) { if (unit.status !== '파괴됨') { let d = dist(this.pos.x, this.pos.y, unit.pos.x, unit.pos.y); if (d < this.range && random(1) < this.fireRate) { samFires.push(new SamFire(this.pos.x, this.pos.y, unit.pos.x, unit.pos.y)); if(!(unit instanceof MannedFighter)) unit.destroy(); return true; } } return false; }
    draw() { noFill(); stroke(255, 100, 100, 40); strokeWeight(2); ellipse(this.pos.x, this.pos.y, this.range * 2); fill(200, 50, 50); noStroke(); rectMode(CENTER); rect(this.pos.x, this.pos.y, 20, 20); }
}
class Explosion { constructor(x, y, col = color(255, 200, 0)) { this.pos = createVector(x, y); this.color = col; this.radius = 0; this.maxRadius = 60; this.duration = 40; this.life = this.duration; } draw() { this.life--; let p = (this.duration - this.life) / this.duration; this.radius = this.maxRadius * (p + 0.5); let a = 255 * (1 - p); fill(red(this.color), green(this.color), blue(this.color), a); noStroke(); ellipse(this.pos.x, this.pos.y, this.radius); } isFinished() { return this.life <= 0; } }
class SamFire { constructor(sx, sy, tx, ty) { this.start = createVector(sx, sy); this.end = createVector(tx, ty); this.life = 20; } draw() { if (this.life > 0) { stroke(255, 0, 0, this.life * 10); strokeWeight(3); line(this.start.x, this.start.y, this.end.x, this.end.y); this.life--; } } isFinished() { return this.life <= 0; } }

function initializeSimulation() {
    simulationRunning = false;
    ticks = 0;
    mannedFighter = null;
    
    uavs = []; targets = []; sams = []; explosions = []; samFires = [];
    
    let startX = 50, startY = height - 50;

    if (simulationMode === 'mumt') {
        mannedFighter = new MannedFighter(startX, startY);
    }
    for (let i = 0; i < config.numUAVs; i++) {
        uavs.push(new UAV(i, startX + (i+1)*30, startY, color(UAV_COLORS[i % UAV_COLORS.length])));
    }
    for (let i = 0; i < config.numTargets; i++) {
        targets.push(new Target(i, random(50, width - 50), random(50, height * 0.7)));
    }
    for (let i = 0; i < config.numSAMs; i++) {
        sams.push(new SAM(i, random(width * 0.2, width * 0.8), random(height * 0.3, height * 0.8)));
    }
    
    logEvent('시뮬레이션 초기화 완료. 작전 모드를 선택하십시오.');
    updateAllInfo();
    redraw();
}
function startSimulation(mode) {
    if (simulationRunning) return;
    simulationMode = mode;
    initializeSimulation();
    if (simulationMode === 'all-out') {
        assignTargetsAllOut();
    }
    simulationRunning = true;
    loop();
    logEvent(`${simulationMode === 'all-out' ? 'AI 전면 공격' : 'AI 지휘관 (MUM-T)'} 작전을 시작합니다!`, 'start');
}
function updateSimulationState() {
    if (simulationMode === 'mumt' && mannedFighter) mannedFighter.update();
    uavs.forEach(uav => uav.update());
    sams.forEach(sam => {
        if (mannedFighter) sam.checkAndFire(mannedFighter);
        uavs.forEach(uav => sam.checkAndFire(uav));
    });
    let activeTargets = targets.filter(t => t.status === '활성').length;
    if (activeTargets === 0) {
        simulationRunning = false;
        noLoop();
        logEvent('모든 표적 파괴. 임무 완수!', 'end');
    }
}
function assignTargetsAllOut() {
    let availableUAVs = uavs.filter(u => u.status !== '파괴됨');
    let activeTargets = targets.filter(t => t.status === '활성');
    availableUAVs.forEach(uav => {
        let bestTarget = null;
        let minDist = Infinity;
        activeTargets.forEach(target => {
            if (!target.isTargeted) {
                let d = p5.Vector.dist(uav.pos, target.pos);
                if (d < minDist) { minDist = d; bestTarget = target; }
            }
        });
        if (bestTarget) { uav.assignTarget(bestTarget); bestTarget.isTargeted = true; }
    });
}
function setupControls() {
    document.getElementById('ai-all-out-btn').onclick = () => startSimulation('all-out');
    document.getElementById('ai-mumt-btn').onclick = () => startSimulation('mumt');
    document.getElementById('reset-btn').onclick = () => {
        simulationMode = 'none';
        initializeSimulation();
    };
    const uavSlider = document.getElementById('uav-slider');
    uavSlider.oninput = () => { config.numUAVs = parseInt(uavSlider.value); initializeSimulation(); };
    const targetSlider = document.getElementById('target-slider');
    targetSlider.oninput = () => { config.numTargets = parseInt(targetSlider.value); initializeSimulation(); };
    const samSlider = document.getElementById('sam-slider');
    samSlider.oninput = () => { config.numSAMs = parseInt(samSlider.value); initializeSimulation(); };
}
function updateAllInfo() {
    document.getElementById('uav-count').innerText = config.numUAVs;
    document.getElementById('target-count').innerText = config.numTargets;
    document.getElementById('sam-count').innerText = config.numSAMs;
    document.getElementById('uav-slider').value = config.numUAVs;
    document.getElementById('target-slider').value = config.numTargets;
    document.getElementById('sam-slider').value = config.numSAMs;
    let modeText = '대기 중';
    if(simulationMode === 'all-out') modeText = 'AI 전면 공격';
    else if (simulationMode === 'mumt') modeText = 'AI 지휘관 (MUM-T)';
    document.getElementById('mode-display').innerText = modeText;
    document.getElementById('time-display').innerText = ticks;
    const destroyedTargets = targets.filter(t => t.status === '파괴됨').length;
    document.getElementById('targets-destroyed-display').innerText = `${destroyedTargets} / ${config.numTargets}`;
    const survivingUAVs = uavs.filter(u => u.status !== '파괴됨').length;
    document.getElementById('uav-survival-display').innerText = `${survivingUAVs} / ${config.numUAVs}`;
    const fighterStatusSpan = document.getElementById('fighter-status-display');
    if (simulationMode === 'mumt' && mannedFighter) {
        fighterStatusSpan.innerText = mannedFighter.status;
        fighterStatusSpan.style.color = (mannedFighter.status === '안전') ? 'var(--safe-color)' : 'var(--warning-color)';
    } else {
        fighterStatusSpan.innerText = 'N/A';
        fighterStatusSpan.style.color = '';
    }
    const tableBody = document.querySelector("#uav-status-table tbody");
    tableBody.innerHTML = "";
    uavs.forEach(uav => {
        let statusClass = 'status-' + uav.status;
        tableBody.innerHTML += `
            <tr>
                <td><span style="color: rgb(${uav.color.levels[0]}, ${uav.color.levels[1]}, ${uav.color.levels[2]})">■</span> #${uav.id}</td>
                <td>${uav.target ? `#${uav.target.id}` : '--'}</td>
                <td class="${statusClass}">${uav.status}</td>
            </tr>
        `;
    });
}
function logEvent(message, type = 'info') {
    const logContainer = document.getElementById('event-log');
    const p = document.createElement('p');
    p.innerHTML = `[T-${String(ticks).padStart(4, '0')}] ${message}`;
    if(type === 'error') p.style.color = 'var(--highlight-color)';
    if(type === 'start') p.style.color = 'var(--accent-color)';
    if(type === 'success') p.style.color = 'var(--safe-color)';
    if(type === 'warn') p.style.color = 'var(--warning-color)';
    logContainer.prepend(p);
    if(logContainer.childElementCount > 30) logContainer.removeChild(logContainer.lastChild);
}
function drawGrid() {
    stroke(40, 70, 100, 100); strokeWeight(1);
    for (let x = 0; x < width; x += 40) { line(x, 0, x, height); }
    for (let y = 0; y < height; y += 40) { line(0, y, width, y); }
}