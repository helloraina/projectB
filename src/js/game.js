import Player from './player';
import Updater from './updater';
import Map from './map';
import Pathfinder from './pathfinder';
import Entity from './entity';
import EntityFactory from './entityfactory';
import GLTFLoader from './gltfloader';

import OrbitControls  from 'three-orbitcontrols';
import Chest from './chest';
import Cutscene from './cutscene';

import ThreeUI from '../lib/three-ui/ThreeUI';


export default class Game {
    init(canvas) {
        const scene = new THREE.Scene();

        const camera = new THREE.PerspectiveCamera( 30, canvas.width / canvas.height, 1, 1000 );
        camera.position.set( 0, 100, 250 );

        const width = canvas.width;
        const height = canvas.height;

        const renderer = new THREE.WebGLRenderer({canvas: canvas});
        renderer.shadowMap.enabled = true;
        renderer.setPixelRatio( window.devicePixelRatio );
        renderer.setSize( width, height);

        const ui = new ThreeUI(canvas, height);

        this.renderer = renderer;
        this.camera = camera;
        this.scene = scene;
        this.ui = ui;

        //===========================
        // 테스트 코드이다.
        const map = {
            width : 10,
            height: 10,
            tileSize: 16,
        }

        const geometry = new THREE.PlaneBufferGeometry(map.width * map.tileSize, map.height * map.tileSize, map.width, map.height );
        const material = new THREE.MeshStandardMaterial( { color: 0x405040, roughness: 0.75 } );
        const plane  = new THREE.Mesh( geometry, material );
        plane.rotation.order = 'YXZ';
        plane.rotation.x = -Math.PI/2;
        plane.receiveShadow = true;
        // 클릭 판정용 바운딩박스
        geometry.computeBoundingBox();
        // 월드용 오프셋을 기록한다


        //scene.add( plane );

        this._terrain = plane;

        // TODO : 카메라 시선을 플레이어에 맞추어야 한다
        camera.lookAt(new THREE.Vector3(0, 0, 0));
        new OrbitControls(camera, renderer.domElement)

        // 게임 정보
        this.entities = {};
        this.entityGrid = null;
        this.phase = null;
        this.nextPhase = null;
    }

    tick() {
        this.currentTime = new Date().getTime();

        // 로직 -> 렌더링 순서로 업데이트를 한다
        this.updater.update();
        this.ui.render();
        this.renderer.render( this.scene, this.camera );
        
        if (!this.isStopped) {
            requestAnimationFrame(this.tick.bind(this));
        }
    }

    start() {
        this.tick();
    }

    stop() {
        this.isStopped = true;
    }

    run(username) {
        // 리소스를 로딩하고 끝날때까지 기다린다.
        this.loadSprites();
        this.loadMap();
        this.loadModel();
        this.updater = new Updater(this);

        const wait = setInterval(() => {
            if (this.map.isLoaded && this.isSpritesLoaded() && this.model) {
                clearInterval(wait);

                // 리소스 로딩이 끝나면 서버에 접속한다
                // 접속이 완료되면 핸들러들을 연결하고 게임을 시작한다
                // TODO : 서버 접속을 만들어야 한다

                // 월드를 생성한다
                // TODO : terrain 생성코드를 나중에 여기로 옮겨와야 한다
                while (this.scene.children.length > 0) {
                    this.scene.remove(this.scene.children[0]);
                }
               

                    
                // 맵을 초기화한다
                // TODO: 맵을 여기서 초기화하도록 코드를 옮겨야 한다
                this.scene.add(this._terrain);
                this.initEntityGrid();
                Entity.setGridSize(this.map.tilesize);

                // 월드 라이트를 추가
                // TODO : map에 따라서 라이트를 바꾸어야 한다
                // 헤미스피어를 붙인다
                const hemiLight = new THREE.HemisphereLight( 0xffffff, 0xffffff, 1 );
                hemiLight.color.setHSL( 0.6, 1, 0.6 );
                hemiLight.groundColor.setHSL( 0.095, 1, 0.75 );
                hemiLight.position.set( 0, 50, 0 );
                this.scene.add( hemiLight );

                
                // 프랍을 배치한다
                let id = 2;
                for(const propData of this.map.props) {
                    const propEntity = EntityFactory.createEntity(propData.kind, id++, "");
                    // 배치할 좌표를 계산한다
                    propEntity.setGridPosition(propData.x, propData.y);
                    
                    if (propEntity instanceof Chest) {
                        propEntity.mesh = this.model.scene.clone();
                        propEntity.mesh.scale.set(3, 3, 3);
                    }
                    
                    this.addEntity(propEntity);
                    this.scene.add(propEntity.mesh);
                }


                this.pathfinder = new Pathfinder(this.map.width, this.map.height)


                // 플레이어를 선언한다
                const player = new Player(1, username, "");
                player.setSprite(this.sprites["clotharmor"]);
                player.onRequestPath((x, y) => {
                    const path = this.findPath(player, x, y);
                    return path;
                });

                player.onStopPathing((x, y) => {
                    if(player.target instanceof Chest) {
                        const chest = player.target;
                        player.target = null;
                        // 다음 프레임에 상자를 제거해버린다. 
                        // TODO : 이것도 좀 영리하게 만들수 없을까?
                        requestAnimationFrame(() => {
                            this.removeEntity(chest);
                            this.scene.remove(chest.mesh);
                            
                        });
                    }
                });

                // TODO : 화면에 배치하고 보이지 않게 하여야 한다
                player.setGridPosition(3, 3);
                this.addEntity(player);
                this.unregisterEntityPosition(player); // 플레이어를 엔티티에 포함시키지않기위한 특수처리
                this.player = player;

                // 게임 씬 페이즈를 선언한다.
                // 등장컷신 -> 전투 -> (승리컷신) -> 탐험 -> 퇴장컷신 . 순으로 만들어진다.
                // 등장 컷신 
                this.nextPhase = new Cutscene(this, "enter");

                // 월드에 추가를 한다
                // TODO : entity 를 일괄로 처리할 수 있는 장치가 필요하다?>
                //this.scene.add(this.player.mesh);
                this.start();

                //==========================================
                // 테스트 코드
                for (const block of player.shatters) {
                   
                    // this.scene.add(block)
                }

                {
                    const geometry2_ = new THREE.PlaneGeometry( 32, 32 );
                    geometry2_.computeFaceNormals();
                    geometry2_.computeBoundingSphere();
                    const tex = new THREE.Texture();
                    tex.image = this.sprites["clotharmor_l"];
                    console.log(tex.image.width, tex.image.height);
                    tex.format = THREE.RGBAFormat;
                    tex.needsUpdate  = true;
                    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
                    tex.repeat.set(1/2, -1);
                    //tex.anisotropy = this.renderer.getMaxAnisotropy();
                    tex.magFilter = THREE.NearestFilter;
                    tex.minFilter = THREE.NearestFilter;


                    const material2_ = new THREE.MeshStandardMaterial({ map: tex, transparent: true });
                    material2_.precision = "highhp";
                    var mesh__ = new THREE.Mesh( geometry2_, material2_ );
                    this.mesh__ = mesh__;
                    //mesh__.lookAt(this.camera.position);
                    this.scene.add(mesh__);

                    console.log(geometry2_);


                    var geometry_ = new THREE.SphereGeometry( 5, 32, 32 );
                    var material_ = new THREE.MeshBasicMaterial({transparent: true, opacity: 0});
                    var sphere = new THREE.Mesh( geometry_, material_ );
                    sphere.scale.set(1, 2, 1);
                    sphere.castShadow = true;
                    //sphere.position.set(24, 16, 12);
                    mesh__.add(sphere);

                    let count = 0;
                    setInterval(() => {
                        count = (count + 1) % 2;
                        tex.offset.x = count / 2;
                    }, 200);
                    //this.scene.add( sphere );
                }
                //==========================================
            }
        }, 100);

    }

    loadSprites() {
        const spriteNames = ["clotharmor", "sword1", "deathknight", "clotharmor_l"];
        const sprites = {};
        for (const spName of spriteNames) {
            const img = new Image();
            img.src = `static/${spName}.png`;
            img.onload = function() {
                img.isLoaded = true;
            }

            sprites[spName] = img;
        }

        this.sprites = sprites;

    }

    loadMap() {
        this.map = new Map();
        this.map.offset = {
            x: this._terrain.geometry.boundingBox.min.x,
            y: this._terrain.geometry.boundingBox.min.y
        };
    }

    loadModel() {
        //const modelNames = ["treasure"];
        var loader = new GLTFLoader();
        loader.load("static/treasure.glb", (glb) => {
            this.model = glb; // 임시 코드... 모델을 어떻게 관리할까?
        },undefined, function ( error ) {

            console.error( error );
        
        });
    }

    isSpritesLoaded() {
        if (_.any(this.sprites, function(sprite) { return !sprite.isLoaded; } )) {
            return false;
        }
        return true;
    }

    initEntityGrid() {
        this.entityGrid = [];
        for(let i=0; i < this.map.height; i += 1) {
            this.entityGrid[i] = [];
            for(let j=0; j < this.map.width; j += 1) {
                this.entityGrid[i][j] = {};
            }
        }
    }

    addEntity(entity) {
        if(this.entities[entity.id] === undefined) {
            this.entities[entity.id] = entity;
            this.registerEntityPosition(entity);
        }
    }

    removeEntity(entity) {
        if(entity.id in this.entities) {
            this.unregisterEntityPosition(entity);
            delete this.entities[entity.id];
        }
    }
  
    registerEntityPosition(entity) {
        const x = entity.gridX;
        const y = entity.gridY;
    
        this.entityGrid[y][x][entity.id] = entity;
    }

    unregisterEntityPosition(entity) {
        const x = entity.gridX;
        const y = entity.gridY;

        if(this.entityGrid[y][x][entity.id]) {
            delete this.entityGrid[y][x][entity.id];
        }
    }

    getEntityAt(x, y) {
        if(this.map.isOutOfBounds(x, y) || !this.entityGrid) {
            return null;
        }
        
        const entities = this.entityGrid[y][x];
        let entity = null;
        if(_.size(entities) > 0) {
            entity = entities[_.keys(entities)[0]];
        } else {
            // entity = this.getItemAt(x, y);
        }
        return entity;
    }

    getItemAt(x, y) {
        return null;
    }

    getGridPosition(intersect, boundingbox) {
        const ts = this.map.tilesize;
        const xIndex = Math.floor((intersect.x - boundingbox.min.x) / ts );
        const yIndex = Math.floor((intersect.z - boundingbox.min.y) / ts );
        
        return { x: xIndex, y: yIndex };
    }

    click(x, y) {
        if (this.ui) {
            const result = this.ui.clickHandler(x, y);
            if (result) {
                return;
            }
        }

        if (this.phase) {
            this.phase.click(x, y);
        }

        const size = new THREE.Vector2();
        this.renderer.getSize(size);

        const mouse = new THREE.Vector2();
        mouse.x = (x / size.x) * 2 - 1;
        mouse.y = -(y / size.y) * 2 + 1;

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera( mouse, this.camera );
        // 지형터치를 어떻게 만들지?
        const intersects = raycaster.intersectObjects(this.scene.children);
        for ( const inter of intersects) {
            const pos = this.getGridPosition(inter.point, this._terrain.geometry.boundingBox);

            // 이제 여기서 무엇을 클릭했는지 조사한다
            const entity = this.getEntityAt(pos.x, pos.y);
            if (entity instanceof Chest) {
                // 상자를 향해  이동한다
                this.player.setTarget(entity);
                this.player.follow(entity);
            } else {
                // 해당 위치로 플레이어를 이동시킨다
                this.player.go(pos.x, pos.y);
            }
        }
    }

    forEachEntity(callback) {
        _.each(this.entities, function(entity) {
            callback(entity);
        });
    }

   
    findPath(character, x, y) {
        const path = [];
        if(this.map.isColliding(x, y)) {
            // 해당 위치가 갈수 없는 곳이다
            return path;
        }
    
        if(this.pathfinder && character) {
            const path = this.pathfinder.findPath(this.map.grid, character, x, y, false);
            return path;
        } 
        return [];
    }
}
