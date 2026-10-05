// SPDX-License-Identifier: GPL-3.0-or-later
// SAAM adapter for unmodified CGAL 6.2.1. See README.md for dependency licenses.
#include <CGAL/Exact_predicates_inexact_constructions_kernel.h>
#include <CGAL/Exact_predicates_exact_constructions_kernel.h>
#include <CGAL/Surface_mesh.h>
#include <CGAL/IO/polygon_soup_io.h>
#include <CGAL/Polygon_mesh_processing/orient_polygon_soup.h>
#include <CGAL/Polygon_mesh_processing/polygon_soup_to_polygon_mesh.h>
#include <CGAL/Polygon_mesh_processing/stitch_borders.h>
#include <CGAL/Polygon_mesh_processing/triangulate_hole.h>
#include <CGAL/Polygon_mesh_processing/autorefinement.h>
#include <CGAL/Polygon_mesh_processing/self_intersections.h>
#include <CGAL/Polygon_mesh_processing/measure.h>
#include <CGAL/boost/graph/border.h>
#include <CGAL/boost/graph/Euler_operations.h>
#include <CGAL/version.h>
#include <algorithm>
#include <array>
#include <cstdint>
#include <chrono>
#include <cmath>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <numeric>
#include <sstream>
namespace PMP=CGAL::Polygon_mesh_processing;
using K=CGAL::Exact_predicates_inexact_constructions_kernel;
using EK=CGAL::Exact_predicates_exact_constructions_kernel;
using Mesh=CGAL::Surface_mesh<K::Point_3>;
using Triangle=std::array<std::size_t,3>;
void stage(const char* name){std::cerr<<"{\"stage\":\""<<name<<"\"}\n";}

struct Face{Triangle v;int weight;};
struct Node{CGAL::Bbox_3 box;std::size_t first,count,left,right;};
struct Bvh{
 std::vector<Node> nodes;std::vector<std::size_t> order;
 std::size_t build(const std::vector<CGAL::Bbox_3>& boxes,std::size_t first,std::size_t count){
  CGAL::Bbox_3 box;for(std::size_t i=first;i<first+count;++i)box+=boxes[order[i]];
  const std::size_t id=nodes.size();nodes.push_back({box,first,count,0,0});
  if(count<=8)return id;
  const double span[3]={box.xmax()-box.xmin(),box.ymax()-box.ymin(),box.zmax()-box.zmin()};
  const int axis=span[0]>=span[1]&&span[0]>=span[2]?0:span[1]>=span[2]?1:2;
  std::nth_element(order.begin()+first,order.begin()+first+count/2,order.begin()+first+count,[&](std::size_t a,std::size_t b){
   return boxes[a].min(axis)+boxes[a].max(axis)<boxes[b].min(axis)+boxes[b].max(axis);});
  const std::size_t left=build(boxes,first,count/2),right=build(boxes,first+count/2,count-count/2);
  nodes[id].left=left;nodes[id].right=right;nodes[id].count=0;return id;
 }
};
// Conservative double test: the exact segment lies within the margin of its
// rounded endpoints, so a missed box cannot hold a crossing.
bool segmentMeetsBox(const double a[3],const double b[3],const CGAL::Bbox_3& box,double margin){
 double lo=0,hi=1;
 for(int k=0;k<3;++k){
  const double d=b[k]-a[k],min=box.min(k)-margin,max=box.max(k)+margin;
  if(d==0){if(a[k]<min||a[k]>max)return false;continue;}
  double t0=(min-a[k])/d,t1=(max-a[k])/d;if(t0>t1)std::swap(t0,t1);
  lo=std::max(lo,t0);hi=std::min(hi,t1);if(lo>hi)return false;
 }
 return true;
}

// SAAM's mesh contract (core/geom/mesh.mjs) needs |(b-a)x(c-a)| > 1e-10 mm^2.
// Arrangement corners can leave smaller triangles: each loses its shortest edge
// with a constructed end, which moves onto the other end. Source vertices stay.
struct Collapse{std::size_t edges=0,remaining=0;double maxMoveMm=0;};
Collapse collapseTinyTriangles(Mesh& mesh,std::vector<K::Point_3> source){
 std::sort(source.begin(),source.end());
 const auto isSource=[&](Mesh::Vertex_index v){return std::binary_search(source.begin(),source.end(),mesh.point(v));};
 const auto tiny=[&](Mesh::Face_index f){
  const auto h=mesh.halfedge(f);const auto& a=mesh.point(mesh.source(h));const auto& b=mesh.point(mesh.target(h));const auto& c=mesh.point(mesh.target(mesh.next(h)));
  const double u[3]={b.x()-a.x(),b.y()-a.y(),b.z()-a.z()},v[3]={c.x()-a.x(),c.y()-a.y(),c.z()-a.z()};
  return std::hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])<=1e-10;
 };
 Collapse out;
 for(bool changed=true;changed;){
  changed=false;
  for(auto f:mesh.faces()){
   if(mesh.is_removed(f)||!tiny(f))continue;
   Mesh::Halfedge_index best;double length=INFINITY;
   for(auto h:CGAL::halfedges_around_face(mesh.halfedge(f),mesh))for(auto g:{h,mesh.opposite(h)}){
    if(isSource(mesh.source(g)))continue;
    const double l=std::sqrt(CGAL::squared_distance(mesh.point(mesh.source(g)),mesh.point(mesh.target(g))));
    if(l<length&&CGAL::Euler::does_satisfy_link_condition(mesh.edge(g),mesh)){best=g;length=l;}
   }
   if(!(length<INFINITY))continue;
   const auto keep=mesh.point(mesh.target(best));
   mesh.point(CGAL::Euler::collapse_edge(mesh.edge(best),mesh))=keep;
   ++out.edges;out.maxMoveMm=std::max(out.maxMoveMm,length);changed=true;
  }
 }
 for(auto f:mesh.faces())if(tiny(f))++out.remaining;
 return out;
}

// Replaces a closed oriented surface that crosses itself by the boundary of
// its solid and returns the report. Exact autorefinement splits triangles along
// every crossing, so refined triangles meet only at shared edges and vertices.
// The solid is where the winding number w is positive: overlapping shells
// unite, inward-facing shells keep their cavities. A refined triangle is kept,
// facing w<=0, exactly when w>0 on one side only. Rounding to doubles follows
// classification because coincident refined triangles carry winding weight.
std::string reconstruct(Mesh& mesh){
 std::size_t coincident=0,cancelled=0,patches=0,rays=0,retries=0,interior=0;
 std::vector<K::Point_3> source(mesh.points().begin(),mesh.points().end());
 std::vector<EK::Point_3> points;points.reserve(source.size());
 for(const auto& p:source)points.emplace_back(p.x(),p.y(),p.z());
 // An inside-out file encloses negative volume; reversing it keeps the solid w>0.
 const bool reversed=PMP::volume(mesh)<0;
 std::vector<Triangle> soup;soup.reserve(mesh.number_of_faces());
 for(auto f:mesh.faces()){
  auto h=mesh.halfedge(f);Triangle t{mesh.target(h).idx(),mesh.target(mesh.next(h)).idx(),mesh.target(mesh.next(mesh.next(h))).idx()};
  if(reversed)std::swap(t[1],t[2]);soup.push_back(t);
 }
 stage("refine");
 PMP::autorefine_triangle_soup(points,soup);
 const std::size_t refined=soup.size();

 // Coincident refined triangles add their orientations; net zero is no surface.
 stage("classify");
 std::vector<std::pair<Triangle,int>> keyed;keyed.reserve(soup.size());
 for(const auto& t:soup){
  Triangle s=t;std::sort(s.begin(),s.end());
  keyed.push_back({s,(t[0]==s[0]&&t[1]==s[1])||(t[0]==s[1]&&t[1]==s[2])||(t[0]==s[2]&&t[1]==s[0])?1:-1});
 }
 soup.clear();soup.shrink_to_fit();
 std::sort(keyed.begin(),keyed.end());
 std::vector<Face> faces;
 for(std::size_t i=0;i<keyed.size();){
  std::size_t j=i;int net=0;while(j<keyed.size()&&keyed[j].first==keyed[i].first)net+=keyed[j++].second;
  if(j-i>1)++coincident;
  const Triangle& s=keyed[i].first;
  if(net>0)faces.push_back({s,net});else if(net<0)faces.push_back({{s[0],s[2],s[1]},-net});else cancelled+=j-i;
  i=j;
 }
 keyed.clear();keyed.shrink_to_fit();
 if(faces.empty())throw std::runtime_error("Solid reconstruction encloses no volume; no result accepted");

 // Patches: faces joined across edges that only they share, with matching
 // orientation and weight, have the same winding on each side.
 struct Edge{std::size_t a,b,face;int direction;};
 std::vector<Edge> edges;edges.reserve(faces.size()*3);
 for(std::size_t f=0;f<faces.size();++f)for(int k=0;k<3;++k){
  const auto u=faces[f].v[k],v=faces[f].v[(k+1)%3];edges.push_back({std::min(u,v),std::max(u,v),f,u<v?1:-1});
 }
 std::sort(edges.begin(),edges.end(),[](const Edge& x,const Edge& y){return x.a!=y.a?x.a<y.a:x.b!=y.b?x.b<y.b:x.face<y.face;});
 std::vector<std::size_t> parent(faces.size());std::iota(parent.begin(),parent.end(),0);
 const auto root=[&](std::size_t x){while(parent[x]!=x)x=parent[x]=parent[parent[x]];return x;};
 for(std::size_t i=0;i<edges.size();){
  std::size_t j=i;long balance=0;
  while(j<edges.size()&&edges[j].a==edges[i].a&&edges[j].b==edges[i].b){balance+=long(edges[j].direction)*faces[edges[j].face].weight;++j;}
  if(balance!=0)throw std::runtime_error("Solid reconstruction needs a closed surface, but refined edges are unbalanced; no result accepted");
  if(j-i==2&&edges[i].direction!=edges[i+1].direction&&faces[edges[i].face].weight==faces[edges[i+1].face].weight)
   parent[root(edges[i].face)]=root(edges[i+1].face);
  i=j;
 }
 edges.clear();edges.shrink_to_fit();

 std::vector<CGAL::Bbox_3> boxes(faces.size());CGAL::Bbox_3 all;
 for(std::size_t f=0;f<faces.size();++f){boxes[f]=points[faces[f].v[0]].bbox()+points[faces[f].v[1]].bbox()+points[faces[f].v[2]].bbox();all+=boxes[f];}
 Bvh bvh;bvh.order.resize(faces.size());std::iota(bvh.order.begin(),bvh.order.end(),0);bvh.build(boxes,0,faces.size());
 double size=0;for(int k=0;k<3;++k)size=std::max(size,all.max(k)-all.min(k));
 const double reach=4*size+1,margin=1e-9*(size+1);
 double centre[3];for(int k=0;k<3;++k)centre[k]=(all.min(k)+all.max(k))/2;

 // Winding on the side of face f that faces q, from the signed crossings of
 // segment centroid->q (w(q)=0 outside). Returns false when the segment meets
 // an edge, vertex or plane degenerately; the caller then tries another q.
 const auto windingToward=[&](std::size_t f,const EK::Point_3& q,long& winding){
  const auto& t=faces[f].v;
  const EK::Point_3 s=CGAL::centroid(points[t[0]],points[t[1]],points[t[2]]);
  if(CGAL::orientation(points[t[0]],points[t[1]],points[t[2]],q)==CGAL::COPLANAR)return false;
  double a[3],b[3];{const auto sb=s.bbox(),qb=q.bbox();for(int k=0;k<3;++k){a[k]=(sb.min(k)+sb.max(k))/2;b[k]=(qb.min(k)+qb.max(k))/2;}}
  long total=0;std::vector<std::size_t> stack{0};
  while(!stack.empty()){
   const Node& node=bvh.nodes[stack.back()];stack.pop_back();
   if(!segmentMeetsBox(a,b,node.box,margin))continue;
   if(node.count==0){stack.push_back(node.left);stack.push_back(node.right);continue;}
   for(std::size_t i=node.first;i<node.first+node.count;++i){
    const std::size_t g=bvh.order[i];if(g==f||!segmentMeetsBox(a,b,boxes[g],margin))continue;
    const auto& p=points[faces[g].v[0]];const auto& r=points[faces[g].v[1]];const auto& u=points[faces[g].v[2]];
    const auto os=CGAL::orientation(p,r,u,s),oq=CGAL::orientation(p,r,u,q);
    if(oq==CGAL::COPLANAR)return false;
    if(os==oq||os==CGAL::COPLANAR)continue;
    const auto e1=CGAL::orientation(s,q,p,r),e2=CGAL::orientation(s,q,r,u),e3=CGAL::orientation(s,q,u,p);
    const bool positive=e1!=CGAL::NEGATIVE&&e2!=CGAL::NEGATIVE&&e3!=CGAL::NEGATIVE,negative=e1!=CGAL::POSITIVE&&e2!=CGAL::POSITIVE&&e3!=CGAL::POSITIVE;
    if(!positive&&!negative)continue;
    if(e1==CGAL::COPLANAR||e2==CGAL::COPLANAR||e3==CGAL::COPLANAR)return false;
    total+=os==CGAL::POSITIVE?faces[g].weight:-faces[g].weight;
   }
  }
  winding=-total;return true;
 };
 std::vector<std::vector<std::size_t>> members(faces.size());
 for(std::size_t f=0;f<faces.size();++f)members[root(f)].push_back(f);
 std::vector<Triangle> kept;
 for(const auto& patch:members){
  if(patch.empty())continue;++patches;
  long front=0;bool known=false;
  // Fixed pseudo-random directions keep the result deterministic. A refined
  // surface always has general-position rays; the bound only stops a defect.
  for(std::size_t attempt=0;!known;++attempt){
   if(attempt>=64*patch.size())throw std::runtime_error("Solid reconstruction found no general-position ray for a surface patch; no result accepted");
   const std::size_t f=patch[attempt%patch.size()];
   const double angle=2.399963229728653*double(attempt+1),z=1-2*std::fmod(0.6180339887498949*double(attempt+1),1.0),radius=std::sqrt(std::max(0.0,1-z*z));
   const EK::Point_3 q(centre[0]+reach*radius*std::cos(angle),centre[1]+reach*radius*std::sin(angle),centre[2]+reach*z);
   long winding;++rays;
   if(!windingToward(f,q,winding)){++retries;continue;}
   const auto& t=faces[f].v;
   front=CGAL::orientation(points[t[0]],points[t[1]],points[t[2]],q)==CGAL::POSITIVE?winding:winding-faces[f].weight;known=true;
  }
  const long back=front+faces[patch.front()].weight;
  if((front>0)==(back>0)){interior+=patch.size();continue;}
  for(auto f:patch){auto t=faces[f].v;if(front>0)std::swap(t[1],t[2]);kept.push_back(t);}
 }
 const std::size_t boundary=kept.size();
 if(kept.empty())throw std::runtime_error("Solid reconstruction encloses no volume; no result accepted");

 // Exact intersection points round to doubles; snap rounding then removes any
 // crossing that rounding created. Source vertices are doubles and stay put.
 stage("round");
 std::vector<K::Point_3> rounded;std::vector<std::size_t> index(points.size(),SIZE_MAX);
 for(auto& t:kept)for(auto& v:t){if(index[v]==SIZE_MAX){index[v]=rounded.size();rounded.emplace_back(CGAL::to_double(points[v].x()),CGAL::to_double(points[v].y()),CGAL::to_double(points[v].z()));}v=index[v];}
 points.clear();points.shrink_to_fit();
 if(!PMP::autorefine_triangle_soup(rounded,kept,CGAL::parameters::apply_iterative_snap_rounding(true)))
  throw std::runtime_error("Rounding the reconstructed surface to doubles left intersections; no result accepted");
 if(!PMP::is_polygon_soup_a_polygon_mesh(kept))throw std::runtime_error("The reconstructed solid touches itself along an edge or at a vertex, so its boundary is not a manifold; no result accepted");
 mesh.clear();PMP::polygon_soup_to_polygon_mesh(rounded,kept,mesh);
 const Collapse collapse=collapseTinyTriangles(mesh,std::move(source));
 if(collapse.remaining)throw std::runtime_error(std::to_string(collapse.remaining)+" reconstructed triangles stay below SAAM's minimum area and cannot be collapsed; no result accepted");
 std::ostringstream report;
 report<<"{\"reversedOrientation\":"<<(reversed?"true":"false")<<",\"refinedTriangles\":"<<refined<<",\"coincidentGroups\":"<<coincident
  <<",\"cancelledTriangles\":"<<cancelled<<",\"patches\":"<<patches<<",\"rays\":"<<rays<<",\"rayRetries\":"<<retries
  <<",\"boundaryTriangles\":"<<boundary<<",\"interiorTriangles\":"<<interior<<",\"collapsedEdges\":"<<collapse.edges<<",\"maxCollapseMm\":"<<collapse.maxMoveMm<<"}";
 return report.str();
}

int main(int argc,char** argv){
 try{
  if(argc==2&&std::string(argv[1])=="--version"){std::cout<<"saam-cgal-mesh-repair/1 CGAL "<<CGAL_VERSION_STR<<"\n";return 0;}
  if(argc!=5)throw std::runtime_error("Expected input.off output.off maxHoleEdges maxHoleDiameterMm");
  const auto started=std::chrono::steady_clock::now();
  const auto max_edges=std::stoull(argv[3]);const double max_diameter=std::stod(argv[4]);
  if(!std::isfinite(max_diameter)||max_diameter<0)throw std::runtime_error("Invalid hole limits");
  stage("orient");
  std::vector<K::Point_3> points;std::vector<std::vector<std::size_t>> faces;
  if(!CGAL::IO::read_polygon_soup(argv[1],points,faces))throw std::runtime_error("Cannot read repair input");
  const auto before_points=points.size(),before_faces=faces.size();
  const bool oriented=PMP::orient_polygon_soup(points,faces);
  const auto split_vertices=points.size()-before_points;
  if(!PMP::is_polygon_soup_a_polygon_mesh(faces))throw std::runtime_error("Cannot resolve polygon soup topology");
  Mesh mesh;PMP::polygon_soup_to_polygon_mesh(points,faces,mesh);
  points.clear();points.shrink_to_fit();faces.clear();faces.shrink_to_fit();
  const auto stitched=PMP::stitch_borders(mesh);
  stage("boundaries");
  std::vector<Mesh::Halfedge_index> borders;CGAL::extract_boundary_cycles(mesh,std::back_inserter(borders));
  std::size_t filled=0,added=0,skipped=0;
  for(auto h:borders){
   if(!mesh.is_border(h))continue;
   std::size_t count=0;auto current=h;double lo[3]={INFINITY,INFINITY,INFINITY},hi[3]={-INFINITY,-INFINITY,-INFINITY};
   do{const auto& p=mesh.point(mesh.target(current));for(int k=0;k<3;++k){const double v=CGAL::to_double(p[k]);lo[k]=std::min(lo[k],v);hi[k]=std::max(hi[k],v);}++count;current=mesh.next(current);}while(current!=h);
   const double diameter=std::sqrt((hi[0]-lo[0])*(hi[0]-lo[0])+(hi[1]-lo[1])*(hi[1]-lo[1])+(hi[2]-lo[2])*(hi[2]-lo[2]));
   if(max_edges==0||count>max_edges||diameter>max_diameter){++skipped;continue;}
   std::vector<Mesh::Face_index> patch;
   PMP::triangulate_hole(mesh,h,CGAL::parameters::face_output_iterator(std::back_inserter(patch)));
   if(!patch.empty()){++filled;added+=patch.size();}
  }
  if(!CGAL::is_closed(mesh))throw std::runtime_error("Open boundaries remain; hole filling requires explicit maxHoleEdges and maxHoleDiameterMm");
  mesh.collect_garbage();
  stage("intersections");
  const bool intersected=PMP::does_self_intersect(mesh);
  const std::string reconstruction=intersected?reconstruct(mesh):"null";
  stage("native-validation");
  if(!CGAL::is_closed(mesh))throw std::runtime_error("Repair output is not closed; no result accepted");
  if(PMP::does_self_intersect(mesh))throw std::runtime_error("CGAL output still intersects; no result accepted");
  mesh.collect_garbage();
  std::ofstream output(argv[2]);output<<std::setprecision(17)<<"OFF\n"<<mesh.number_of_vertices()<<' '<<mesh.number_of_faces()<<" 0\n";
  for(auto v:mesh.vertices())output<<mesh.point(v)<<'\n';
  for(auto f:mesh.faces()){auto h=mesh.halfedge(f);output<<"3 "<<mesh.target(h).idx()<<' '<<mesh.target(mesh.next(h)).idx()<<' '<<mesh.target(mesh.next(mesh.next(h))).idx()<<'\n';}
  output.close();if(!output)throw std::runtime_error("Cannot write repair output");
  std::cout<<"{\"backend\":\"CGAL "<<CGAL_VERSION_STR<<"\",\"method\":\"cgal-solid-repair/2\",\"inputTriangles\":"<<before_faces
   <<",\"orientReturned\":"<<(oriented?"true":"false")<<",\"splitVertices\":"<<split_vertices<<",\"stitchedPairs\":"<<stitched
   <<",\"holesFilled\":"<<filled<<",\"holeTrianglesAdded\":"<<added<<",\"holesSkipped\":"<<skipped
   <<",\"selfIntersectionsRepaired\":"<<(intersected?"true":"false")<<",\"reconstruction\":"<<reconstruction
   <<",\"outputTriangles\":"<<mesh.number_of_faces()<<",\"nativeSeconds\":"<<std::chrono::duration<double>(std::chrono::steady_clock::now()-started).count()<<"}\n";
 }catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}return 0;
}
